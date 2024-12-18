const token = getTokenFromIndexedDB();
const url = 'https://sredapi.websitos256.com';

let cacheName = "SREDCacheV1";
self.addEventListener("install", function (e) {
    e.waitUntil(precache());
    createIndexedDbTokens();
});


async function precache() {
    let cache = await caches.open(cacheName);
}

self.addEventListener('fetch', event => {

   
    const excludedUrls = [
        'browserLinkSignalR', // Puedes agregar más palabras clave o rutas específicas
        '/abort',
        'connectionToken'
    ];

    
    if (excludedUrls.some((urlPart) => event.request.url.includes(urlPart))) {
        return; 
    }
    if ((event.request.method === 'PUT' || event.request.method === 'POST') && !event.request.url.includes("/api/Login/UserLog") && !event.request.url.includes("/api/Login")) {
        event.respondWith(handlePostOrPut(event.request));
        return;
    }
    if (event.request.url.includes("/api/") && event.request.method === "GET" && navigator.onLine) {
        event.respondWith((async () => {
            const cache = await caches.open('SREDCacheV1'); // Abre o crea un caché llamado "api-cache"
            const token = await getTokenFromIndexedDB();

            if (token) {
                const resp = decodeJWT(token);
                const now = Math.floor(Date.now() / 1000);

                if (resp.exp && resp.exp >= now) {
                    const headers = new Headers(event.request.headers);
                    headers.set('Authorization', `Bearer ${token}`);

                    const modifiedRequest = new Request(event.request, {
                        method: event.request.method,
                        headers: headers,
                        body: event.request.body,
                        mode: event.request.mode,
                        credentials: event.request.credentials,
                    });

                    try {
                        const networkResponse = await fetch(modifiedRequest);

                        if (networkResponse.ok) {
                            // Guarda la respuesta en el caché
                            cache.put(modifiedRequest, networkResponse.clone());
                        }
                        return networkResponse;
                    } catch (error) {
                        console.error("Error al realizar la solicitud de red:", error);
                        // Si falla, intenta obtener la respuesta del caché
                        const cachedResponse = await cache.match(modifiedRequest);
                        if (cachedResponse) {
                            return cachedResponse;
                        }
                        return new Response("Error de red y el recurso no está en caché.", { status: 503 });
                    }
                }

                try {
                    // Si el token ha expirado, intenta renovarlo
                    const newToken = await refreshSessionWithToken(resp);
                    await saveTokenToIndexedDB(newToken);

                    const headers = new Headers(event.request.headers);
                    headers.set('Authorization', `Bearer ${newToken}`);

                    const modifiedRequest = new Request(event.request, {
                        method: event.request.method,
                        headers: headers,
                        body: event.request.body,
                        mode: event.request.mode,
                        credentials: event.request.credentials,
                    });

                    const networkResponse = await fetch(modifiedRequest);

                    if (networkResponse.ok) {
                        // Guarda la nueva respuesta en el caché
                        cache.put(modifiedRequest, networkResponse.clone());
                    }
                    return networkResponse;
                } catch (error) {
                    console.error("Error al renovar el token:", error);
                    return new Response("Failed to renew token", { status: 401 });
                }
            }

            console.warn("Token no válido o no encontrado.");
            return new Response("Token inválido o expirado", { status: 401 });
        })());
        return;
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
        return;
    }
    if (event.request.method === "GET" && (event.request.url.includes("/token"))) {
        event.respondWith(
            (async () => {
                try {
                    const decodedToken = await tokenDecode();


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
    if (event.request.method === "POST" && (event.request.url.includes("/api/Login/UserLog") || event.request.url.includes("/api/Login"))
    ) {
        event.respondWith(
            (async () => {
                try {

                    const clonedRequest = event.request.clone();
                    const requestBody = await clonedRequest.clone().text();
                    let password = "";
                    try {
                        const parsedBody = JSON.parse(requestBody);
                        password = parsedBody.contrasena || "";
                    } catch (e) {
                        console.error("No se pudo parsear el cuerpo de la solicitud:", e);
                    }
                    if (password) {
                        const base64Password = btoa(password);
                        await savePasswordToIndexedDB(base64Password);
                        console.log("Contraseña guardada exitosamente en IndexedDB como Base64.");
                    }

                    const response = await fetch(clonedRequest);
                    const data = await response.clone().text();

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
        return;
    }
    //if (event.request.method === "GET" && event.request.url.includes("/api/")) {
    //    event.respondWith((async () => {
    //        const token = await getTokenFromIndexedDB();

    //        // Modificar la solicitud para incluir el token
    //        const headers = new Headers(event.request.headers);
    //        if (token) {
    //            headers.set('Authorization', `Bearer ${token}`);
    //        }

    //        const modifiedRequest = new Request(event.request, {
    //            method: event.request.method,
    //            headers: headers,
    //            body: event.request.body,
    //            mode: event.request.mode,
    //            credentials: event.request.credentials,
    //        });

    //        const cache = await caches.open(cacheName);

    //        try {
    //            // Intentar obtener la respuesta de la red
    //            const networkResponse = await fetch(modifiedRequest);
    //            if (networkResponse.ok) {
    //                // Almacenar la respuesta en el caché
    //                cache.put(event.request, networkResponse.clone());
    //            }
    //            return networkResponse;
    //        } catch (error) {
    //            console.warn('Network fetch failed, falling back to cache:', error);
    //            // Si la red falla, intenta obtener la respuesta del caché
    //            const cachedResponse = await cache.match(event.request);
    //            if (cachedResponse) {
    //                return cachedResponse;
    //            }
    //            return new Response("Recurso no disponible en caché ni en la red", { status: 503 });
    //        }
    //    })());
    //    return;
    //}
    else {
        // Para otras solicitudes, no se realiza ninguna modificación
        event.respondWith(networkFirst(event.request));
    }
});
self.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'SYNC_PENDING_REQUESTS') {
        console.log('Sincronizando solicitudes pendientes...');
        await syncPendingRequests();
    }
});
async function syncPendingRequests() {
    const db = await createIndexedDB();
    const transaction = db.transaction('pendingRequests', 'readonly');
    const store = transaction.objectStore('pendingRequests');

    const allRequests = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });


    for (const savedRequest of allRequests) {
        const { url, method, headers, body, timestamp, credentials,mode} = savedRequest;

        try {
            const token = await getTokenFromIndexedDB();
            const newheaders = new Headers(headers);
            newheaders.set('Authorization', `Bearer ${token}`);

            // Crear una nueva solicitud con los encabezados modificados
            const modifiedRequest = new Request(url, {
                method: method,
                headers: newheaders,
                body: body,
                mode: mode,
                credentials: credentials,
                duplex: "half", 
            });

            const response = await fetch(modifiedRequest);

            if (response.ok) {
                console.log(`Solicitud reenviada con éxito: ${url}`);
                await deleteRequestFromIndexedDB(timestamp);
            } else {
                console.warn(`Error en la solicitud: ${url}, estado: ${response.status}`);
            }
        } catch (error) {
            console.error(`Error al reenviar la solicitud (${url}):`, error);

        }
    }
}


async function handlePostOrPut(request) {
    const clone = request.clone();

    const token = await getTokenFromIndexedDB();
    try {
        if (token) {
            const headers = new Headers(clone.headers);
            headers.set('Authorization', `Bearer ${token}`);

            // Crear una nueva solicitud con los encabezados modificados
            const modifiedRequest = new Request(clone, {
                method: clone.method,
                headers: headers,
                body: clone.body,
                mode: clone.mode,
                credentials: clone.credentials,
                duplex: "half",  // Esto es importante si el cuerpo es un stream
            });

            // Intentar hacer la solicitud
            const response = await fetch(modifiedRequest);
            if (response.ok) {
                return response; // Si la respuesta es OK, devolverla
            } else {
                throw new Error('Network response was not ok');
            }

        } else {
            console.warn("Token no encontrado o es inválido");
            return new Response("Token no encontrado o es inválido", { status: 401 });
        }


    } catch (error) {


        // Crear una nueva solicitud con los encabezados modificados

        await saveRequestToIndexedDB(request);


        return new Response(JSON.stringify({ message: 'Solicitud almacenada y será enviada más tarde.' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    return new Response("Token no encontrado o es inválido", { status: 401 });
}


async function saveRequestToIndexedDB(request) {
    const db = await createIndexedDB();
    const body = await request.clone().text();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction('pendingRequests', 'readwrite');
        const store = transaction.objectStore('pendingRequests');

        try {
            const requestData = {
                url: request.url,
                method: request.method,
                headers: [...request.headers.entries()],
                body: body,
                timestamp: Date.now(),
            };

            const requestAdd = store.add(requestData);

            requestAdd.onsuccess = () => {
                console.log('Request saved to IndexedDB successfully');
                resolve();
            };

            requestAdd.onerror = (event) => {
                console.error('Failed to save request:', event.target.error);
                reject(event.target.error);
            };

        } catch (error) {
            console.error('Error in transaction:', error);
            reject(error);
        }

        transaction.oncomplete = () => console.log('Transaction completed successfully.');
        transaction.onerror = (event) => reject('Transaction failed: ' + event.target.error);
    });
}

async function deleteRequestFromIndexedDB(timestamp) {
    const db = await createIndexedDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('pendingRequests', 'readwrite');
        const store = transaction.objectStore('pendingRequests');

        const deleteRequest = store.delete(timestamp);

        deleteRequest.onsuccess = () => {
            console.log(`Request with timestamp ${timestamp} deleted from IndexedDB.`);
            resolve();
        };

        deleteRequest.onerror = (event) => {
            console.error('Failed to delete request:', event.target.error);
            reject(event.target.error);
        };

        transaction.oncomplete = () => console.log('Delete transaction completed successfully.');
        transaction.onerror = (event) => reject('Delete transaction failed: ' + event.target.error);
    });
}



async function createIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('PendingRequestsDB', 1);

        request.onupgradeneeded = function (event) {
            const db = event.target.result;

            if (!db.objectStoreNames.contains('pendingRequests')) {
                db.createObjectStore('pendingRequests', { keyPath: 'timestamp' });
            }
        };

        request.onsuccess = function (event) {
            resolve(event.target.result);
        };

        request.onerror = function (event) {
            reject('Error al abrir IndexedDB: ' + event.target.errorCode);
        };
    });
}

async function refreshSessionWithToken(decodedToken) {
    const data = {
        usuario: "",
        contrasena: "",
    };


    const role = decodedToken["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"];
    const username = decodedToken["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"];
    let log = "/api/Login/UserLog";
    let pass = atob(await getPasswordFromIndexedDB());
    if (role !== "Invitado") {

        data.usuario = username;


        try {
            data.contrasena = pass
            log = "/api/Login";
        } catch (error) {
            console.error("Error desencriptando la contraseña:", error);
            throw new Error("Failed to decrypt password");
        }
    } else {
        data.usuario = username;
        data.contrasena = pass;
    }
    let endpoint = url + log;

    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error("Failed to refresh session");
    }
    const responseData = await response.text();
    return responseData;
}
async function getPasswordFromIndexedDB() {
    const db = await createIndexedDbTokens();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction("tokens", "readonly");
        const store = transaction.objectStore("tokens");

        const request = store.get("userPassword");

        request.onsuccess = function (event) {
            const passwordData = event.target.result;
            if (passwordData) {
                resolve(passwordData.password);
            } else {
                resolve(null);
            }
        };

        request.onerror = function (event) {
            console.error("Error al leer la contraseña de IndexedDB:", event);
            reject(event);
        };
    });
}

async function savePasswordToIndexedDB(base64Password) {
    const db = await createIndexedDbTokens();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("tokens", "readwrite");
        const store = transaction.objectStore("tokens");


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
    const db = await createIndexedDbTokens();
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
    const db = await createIndexedDbTokens();
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


async function createIndexedDbTokens() {
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
    const db = await createIndexedDbTokens();
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