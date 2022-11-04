function isBrowser(): boolean {
  return typeof window !== "undefined";
}

type FetchMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * Returns the response from the url. If in the browser it will use the fetch method otherwise it will use nodejs http or https module.
 *
 * @param url The url to fetch the data from.
 * @param method Fetch method, GET as default.
 * @param params Params to be passed in the request body.
 *
 * @returns json data from the url.
 */
export async function crossFetch<T>(
  url: string,
  method: FetchMethod = "GET",
  params?: any,
): Promise<T> {
  if (isBrowser()) {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: params ? JSON.stringify(params) : undefined,
    });
    return await response.json();
  } else {
    return await nodeFetch<T>(url, method, params);
  }
}

function nodeFetch<T>(
  url: string,
  method: FetchMethod = "GET",
  params?: any,
): Promise<T> {
  let protocol;
  if (url.startsWith("https")) {
    protocol = "https";
    url = url.substring(8);
  } else {
    protocol = "http";
    url = url.substring(7);
  }
  const http = require(protocol); // eslint-disable-line
  const body = JSON.stringify(params);
  const options = {
    host: url.substring(0, url.indexOf("/api/")),
    path: url.substring(url.indexOf("/api/")),
    method,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body || ""),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (response: any) => {
      let data = "";

      response.on("data", (chunk: any) => {
        data += chunk;
      });

      response.on("end", () => {
        resolve(JSON.parse(data));
      });

      response.on("error", () => {
        reject();
      });
    });
    if (body) {
      req.write(body);
    }
    req.end();
  });
}
