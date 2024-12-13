﻿
let cacheName = "SREDCacheV1";
self.addEventListener("install", function (e) {
    e.waitUntil(precache());
});


async function precache() {
    let cache = await caches.open(cacheName);
    /* await cache.add("api/");*/

}

self.addEventListener('fetch', event => {

    createIndexedDB();
    //if (event.request.url.includes('/assets/')
    //    || event.request.url.includes('/css/')
    //    || event.request.url.includes('/js/')
    //    || event.request.url.includes('/fonts/')
    //    || event.request.url.includes('/Pages/Index')
    //    || event.request.url.includes('/Pages/LogInAdmin')) {
    //    event.respondWith(cacheFirst(event.request))
    //}
    //if (event.request.method === "GET" && event.request.url.includes("/api/Reporte/pornumerocontrol")) {
    //    event.respondWith(cacheFirst(event.request));
    //    return;
    //}

    // Continúa con las reglas
    if (event.request.method == "POST" && (event.request.url.includes("/api/Login/UserLog") || event.request.url.includes("/api/Login"))) {
        event.respondWith(
            (async () => {
                try {
                    const response = await fetch(event.request.clone());
                    const data = await response.clone().text();

                    if (response.ok && data) {


                        // Guardar el token en IndexedDB
                        await saveTokenToIndexedDB(data);



                        console.log("Token guardado exitosamente en IndexedDB desde el Service Worker.");

                    } else {
                        console.warn("La respuesta no contenía un token válido.");
                    }

                    return response;
                } catch (error) {
                    console.error("Error al manejar la solicitud de login:", error);
                    return new Response("Error al manejar la solicitud de login.", { status: 500 });
                }
            })()
        );
    }
    else {
        event.respondWith(cacheFirst(event.request));

    }
    //else if (event.request.method == "GET" && (event.request.url.includes("api/Aula")
    //    || event.request.url.includes("api/Equipo") || event.request.url.includes("api/Tipo"))) {
    //    event.respondWith(cacheFirst(event.request));

    //} else {

    //    event.respondWith(networkFirst(event.request));
    //}

} );
function decodeJWT(token) {
    const payloadBase64 = token.split('.')[1];
    const decodedPayload = atob(payloadBase64);
    return JSON.parse(decodedPayload);
}



async function createIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("AuthDatabase", 1);

        request.onupgradeneeded = function (event) {
            const db = event.target.result;

            if (!db.objectStoreNames.contains("tokens")) {
                db.createObjectStore("tokens", { keyPath: "id" });
            }
        };

        request.onsuccess = function (event) {
            resolve(event.target.result);
        };

        request.onerror = function (event) {
            reject("Error al crear la base de datos: " + event.target.errorCode);
        };
    });
}

async function saveTokenToIndexedDB(token) {
    const db = await createIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("tokens", "readwrite");
        const store = transaction.objectStore("tokens");

        store.put({ id: "authToken", token });

        transaction.oncomplete = function () {
            console.log("Token guardado en IndexedDB.");
            resolve();
        };

        transaction.onerror = function (event) {
            console.error("Error al guardar el token en IndexedDB:", event);
            reject(event);
        };
    });
}


async function networkIndexDbFallBack(req) {
    let clon = req.clone();
    try {
        let resp = await fetch(req);
        return resp;
    } catch (e) {
        let res = await clon.json();
        addToDatabase(res);
        //registrarme a un sync para que me avise cuando regrese la conexion

        await self.registration.sync.register("enviar-respuestas");
        return new Response({ status: 200 });
    }
}

async function networkOnly(req) {
    try {
        let response = await fetch(req);
        if (response.ok) {
            return response;
        } else {
            return new Response("Error al obtener la respuesta de la red", { status: response.status });
        }
    } catch (error) {
        console.log(error);
        return new Response("Error al acceder a la red", { status: 500 });
    }
}


async function cacheOnly(req) {
    try {
        let cache = await caches.open(cacheName);
        let response = await cache.match(req);
        if (response) {
            return response;
        } else {
            return new Response("No se encontró en caché", { status: 404 });
        }
    } catch (x) {
        console.log(x);
        return new Response("Error al acceder al caché", { status: 500 });
    }
}

async function cacheFirst(req) {
    try {
        let cache = await caches.open(cacheName);
        let response = await cache.match(req);
        if (response) {
            return response;
        } else {
            let respuesta = await fetch(req);
            if (respuesta.ok) { // Verificar si la respuesta es válida
                cache.put(req, respuesta.clone());
            }
            return respuesta;
        }
    } catch (x) {
        console.log(x);
        return new Response("Error fetching the resource: " + req.url, { status: 500 });
    }
}

async function networkFirst(req) {
    let cache = await caches.open(cacheName);
    try {
        let respuesta = await fetch(req);
        if (respuesta.ok) {
            cache.put(req, respuesta.clone());
        }
        return respuesta;
    } catch (x) {
        let response = await cache.match(req);
        if (response) {
            return response;
        } else {
            console.log(x);
            return new Response("Recurso no disponible en caché ni en la red", { status: 503 });
        }
    }
}

async function staleWhileRevalidate(url) {
    try {
        let cache = await caches.open(cacheName);
        let response = await cache.match(url);

        let fetchPromise = fetch(url).then(async networkResponse => {
            if (networkResponse.ok) {
                await cache.put(url, networkResponse.clone());
            }
            return networkResponse;
        }).catch(err => {
            console.log("Error fetching from network:", err);
        });

        return response || fetchPromise;
    } catch (x) {
        console.log("Error en staleWhileRevalidate:", x);
        return new Response("Error interno", { status: 500 });
    }
}
async function staleThenRevalidate(req) {
    try {

        let cache = await caches.open(cacheName);
        let cachedResponse = await cache.match(req);

        if (cachedResponse) {
            fetch(req).then(async (networkResponse) => {
                if (networkResponse.ok) {
                    let cacheData = await cachedResponse.clone().text();
                    let networkData = await networkResponse.clone().text();

                    if (cacheData !== networkData) {
                        await cache.put(req, networkResponse.clone());
                        channel.postMessage({
                            url: req.url,
                            data: networkData
                        });
                    }
                }
            }).catch(err => {
                console.log("Error al obtener la respuesta de la red:", err);
            });

            return cachedResponse.clone();
        } else {
            return networkFirst(req);
        }
    } catch (error) {
        console.log("Error en staleThenRevalidate:", error);
        return new Response("Error interno", { status: 500 });
    }
}

let maxage = 24 * 60 * 60 * 1000;

async function timeBasedCache(req) {
    try {

        let cache = await caches.open(cacheName);
        let cachedResponse = await cache.match(req);

        if (cachedResponse) {
            let fechaDescarga = cachedResponse.headers.get("fecha");

            if (fechaDescarga) {
                let fecha = new Date(fechaDescarga);
                let hoy = new Date();
                let diferencia = hoy - fecha;

                if (diferencia <= maxage) {
                    return cachedResponse;
                }
            }
        }

        let networkResponse = await fetch(req);

        if (networkResponse.ok) {
            let nuevoResponse = new Response(networkResponse.body, {
                status: networkResponse.status,
                statusText: networkResponse.statusText,
                headers: networkResponse.headers
            });
            nuevoResponse.headers.append("fecha", new Date().toISOString());  // Añadir la fecha de la descarga
            await cache.put(req, nuevoResponse.clone());  // Guardar en el caché

            return nuevoResponse;
        } else {
            return new Response("Error en la red", { status: 502 });
        }

    } catch (error) {
        console.log("Error en timeBasedCache:", error);
        return new Response("Error interno", { status: 500 });
    }
}

async function networkCacheRace(req) {
    try {
        let cache = await caches.open(cacheName);

        let networkPromise = fetch(req).then(response => {
            if (response.ok) {
                cache.put(req, response.clone());
                return response;
            }
            throw new Error("Error en la respuesta de red");
        });

        let cachePromise = cache.match(req);

        return await Promise.race([networkPromise, cachePromise]);

    } catch (error) {
        console.log("Error en networkCacheRace:", error);
        return new Response("Error en la obtención de datos", { status: 500 });
    }
}