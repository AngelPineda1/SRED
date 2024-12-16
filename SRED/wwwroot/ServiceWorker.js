const token = getTokenFromIndexedDB();
const url = 'https://sredapi.websitos256.com';

let cacheName = "SREDCacheV1";
self.addEventListener("install", function (e) {
    e.waitUntil(precache());
    createIndexedDB();
});


async function precache() {
    let cache = await caches.open(cacheName);
    /* await cache.add("api/");*/

}

self.addEventListener('fetch', event => {

    //if (event.request.url.includes('/assets/')
    //    || event.request.url.includes('/css/')
    //    || event.request.url.includes('/js/')
    //    || event.request.url.includes('/fonts/')
    //    || event.request.url.includes('/Pages/Index')
    //    || event.request.url.includes('/Pages/LogInAdmin')) {
    //    event.respondWith(cacheFirst(event.request))
    //}

    if (event.request.url.includes("/api/") && event.request.method === "GET") {
        event.respondWith((async () => {
            const token = await getTokenFromIndexedDB();
            if (token) {
                const resp = decodeJWT(token);


                const now = Math.floor(Date.now() / 1000);

                if (resp.exp && resp.exp < now) {

                    try {
                        const newToken = await refreshSessionWithToken(resp);
                        await saveTokenToIndexedDB(newToken);
                    } catch (error) {
                        console.error("Error al renovar el token:", error);
                        return new Response("Failed to renew token", { status: 401 });
                    }
                }
            }

            // Continúa con la solicitud original.
            return fetch(event.request);
        })());
    }
    if (event.request.url.includes("/logout")) {
        event.respondWith((async () => {
            const token = await getTokenFromIndexedDB();
            if (token) {

                try {
                    await deleteTokenFromIndexedDB();
                    const response = new Response("Logout successful", { status: 200 });
                    return response;
                } catch (ex) {
                    console.error("Error during logout:", ex);
                    return new Response("Error during logout", { status: 500 });
                }
                return response;
            } else {
                return new Response("No token found", { status: 400 });
            }
        })());
    }
    if (event.request.method === "GET" && (event.request.url.includes("/token"))) {
        event.respondWith(
            (async () => {
                try {
                    const decodedToken = await tokenDecode();  // Obtiene y valida el token


                    const response = new Response(JSON.stringify({ token: decodedToken }), {
                        headers: { 'Content-Type': 'application/json' },
                        status: 200
                    });
                    return response;
                } catch (error) {

                    console.error(error.message);
                    return new Response(JSON.stringify({ error: error.message }), {
                        headers: { 'Content-Type': 'application/json' },
                        status: 401
                    });
                }
                return response;
            })()
        );
        return;
    }
    // Continúa con las reglas
    if (
        event.request.method === "POST" &&
        (event.request.url.includes("/api/Login/UserLog") || event.request.url.includes("/api/Login"))
    ) {
        event.respondWith(
            (async () => {
                try {
                    // Clona la solicitud para leer su cuerpo
                    const clonedRequest = event.request.clone();
                    const requestBody = await clonedRequest.clone().text(); // Obtén el cuerpo como texto

                    // Intenta parsear el cuerpo para obtener la contraseña
                    let password = "";
                    try {
                        const parsedBody = JSON.parse(requestBody);
                        password = parsedBody.contrasena || ""; // Suponiendo que la contraseña está en `password`
                    } catch (e) {
                        console.error("No se pudo parsear el cuerpo de la solicitud:", e);
                    }

                    // Convierte la contraseña a Base64 si está presente
                    if (password) {
                        const base64Password = btoa(password);

                        // Guarda la contraseña en IndexedDB
                        await savePasswordToIndexedDB(base64Password);
                        console.log("Contraseña guardada exitosamente en IndexedDB como Base64.");

                    }

                    // Realiza la solicitud original
                    const response = await fetch(clonedRequest);
                    const data = await response.clone().text();

                    // Guardar el token si la respuesta es válida
                    if (response.clone().ok && data) {
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
        event.respondWith(networkFirst(event.request));


    }
});

async function refreshSessionWithToken(decodedToken) {
    const data = {
        usuario: "",
        contrasena: "",
    };

    // Identificar el rol del usuario
    const role = decodedToken["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"];
    const username = decodedToken["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"];
    let log = "/api/Login/UserLog";
    let pass = atob(await getPasswordFromIndexedDB());
    if (role !== "Invitado") {
        // Caso para roles diferentes a "Invitado"
        data.usuario = username;

        // Desencripta la contraseña en SHA-512
        try {
            data.contrasena = pass
            endpoint = "/api/Login"; // Cambia al endpoint correspondiente
        } catch (error) {
            console.error("Error desencriptando la contraseña:", error);
            throw new Error("Failed to decrypt password");
        }
    } else {
        // Caso para "Invitado"
        data.usuario = username;
        data.contrasena = pass;
    }
    let endpoint = url + log;
    // Realiza la solicitud al endpoint correspondiente
    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error("Failed to refresh session");
    }

    // Procesa la respuesta y devuelve el nuevo token
    const responseData = await response.text();
    return responseData;
}
async function getPasswordFromIndexedDB() {
    const db = await createIndexedDB(); // Supongamos que tienes la función 'createIndexedDB' para abrir la base de datos.

    return new Promise((resolve, reject) => {
        const transaction = db.transaction("tokens", "readonly");
        const store = transaction.objectStore("tokens");

        const request = store.get("userPassword"); // Obtén el objeto almacenado con la clave 'userPassword'

        request.onsuccess = function (event) {
            const passwordData = event.target.result;
            if (passwordData) {
                resolve(passwordData.password); // Devuelve la contraseña almacenada como texto plano
            } else {
                resolve(null); // Si no se encuentra la contraseña
            }
        };

        request.onerror = function (event) {
            console.error("Error al leer la contraseña de IndexedDB:", event);
            reject(event);
        };
    });
}

async function savePasswordToIndexedDB(base64Password) {
    const db = await createIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("tokens", "readwrite");
        const store = transaction.objectStore("tokens");

        // Guarda la contraseña bajo una clave específica
        store.put({ id: "userPassword", password: base64Password });

        transaction.oncomplete = function () {
            console.log("Contraseña guardada en IndexedDB.");
            resolve();
        };

        transaction.onerror = function (event) {
            console.error("Error al guardar la contraseña en IndexedDB:", event);
            reject(event);
        };
    });
}

function decodeJWT(token) {
    const payloadBase64 = token.split('.')[1];
    const decodedPayload = atob(payloadBase64);
    return JSON.parse(decodedPayload);
}
async function tokenDecode() {
    const token = await getTokenFromIndexedDB();
    if (token) {
        const resp = (decodeJWT(token));

        const now = Math.floor(Date.now() / 1000);
        if (resp.exp && resp.exp < now) {
            throw new Error('Token has expired');
        }

        return resp;

    }
    return null;

}
async function deleteTokenFromIndexedDB() {
    const db = await createIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("tokens", "readwrite");
        const store = transaction.objectStore("tokens");

        const request = store.delete("authToken");


        request.onsuccess = function () {
            console.log("Token eliminado de IndexedDB.");
            resolve();
        };

        request.onerror = function (event) {
            console.error("Error al eliminar el token de IndexedDB:", event);
            reject(event);
        };

        const passwordRequest = store.delete("userPassword");
        passwordRequest.onsuccess = function () {
            console.log("Contraseña eliminada de IndexedDB.");
            resolve();
        };

        passwordRequest.onerror = function (event) {
            console.error("Error al eliminar la contraseña de IndexedDB:", event);
            reject(event);
        };
    });
}


async function getTokenFromIndexedDB() {
    const db = await createIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("tokens", "readonly");
        const store = transaction.objectStore("tokens");

        const request = store.get("authToken");

        request.onsuccess = function (event) {
            const token = event.target.result ? event.target.result.token : null;
            resolve(token);
        };

        request.onerror = function (event) {
            console.error("Error al leer el token de IndexedDB:", event);
            reject(event);
        };
    });
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