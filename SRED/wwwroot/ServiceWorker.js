const token = getTokenFromIndexedDB();
const url = 'https://sredapi.websitos256.com';

let cacheName = "SREDCacheV1";
self.addEventListener("install", function (e) {
    e.waitUntil(precache());
    createIndexedDbTokens();
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
    if ((event.request.method === 'PUT' || event.request.method === 'POST') && !event.request.url.includes("/api/Login/UserLog") && !event.request.url.includes("/api/Login")) {
        event.respondWith(handlePostOrPut(event.request));
        return;
    }
    if (event.request.url.includes("/api/") && event.request.method === "GET" && navigator.onLine) {
        event.respondWith((async () => {
            const token = await getTokenFromIndexedDB();
            if (token) {
                const resp = decodeJWT(token);


                const now = Math.floor(Date.now() / 1000);
                if (resp.exp && resp.exp >= now) {

                    return fetch(event.request);
                }


                try {
                    const newToken = await refreshSessionWithToken(resp);
                    await saveTokenToIndexedDB(newToken);


                    
                    return fetch(event.request);

                } catch (error) {
                    console.error("Error al renovar el token:", error);
                    return new Response("Failed to renew token", { status: 401 });
                }

            }


            console.warn("Token no válido o no encontrado.");
            return new Response("Token inválido o expirado", { status: 401 });
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
        const { url, method, headers, body, timestamp } = savedRequest;

        try {
            const request = new Request(url, {
                method: method,
                headers: new Headers(headers),
                body: body,
            });

            const response = await fetch(request);

            if (response.ok) {
                console.log(`Solicitud reenviada con éxito: ${url}`);
                await deleteRequestFromIndexedDB(timestamp);
            } else {
                console.warn(`Error en la solicitud: ${url}, estado: ${response.status}`);
            }
        } catch (error) {
            console.error(`Error al reenviar la solicitud (${url}):`, error);
            // No eliminamos la solicitud para intentar de nuevo más tarde
        }
    }
}


async function handlePostOrPut(request) {
    const clone = request.clone();

    try {
        
        const response = await fetch(request);
        if (response.ok) {
            return response;
        } else {
            throw new Error('Network response was not ok');
        }
    } catch (error) {
      
        await saveRequestToIndexedDB(clone);
       
     
        return new Response(JSON.stringify({ message: 'Solicitud almacenada y será enviada más tarde.' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
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



// Sincroniza las solicitudes pendientes

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


// Crea la base de datos IndexedDB para solicitudes pendientes
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
    const db = await createIndexedDbTokens(); // Supongamos que tienes la función 'createIndexedDB' para abrir la base de datos.

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
    const db = await createIndexedDbTokens();
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