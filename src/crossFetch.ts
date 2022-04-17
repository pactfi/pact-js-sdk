function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Returns the response from the url. If in the browser it will use the fetch method otherwise it will use nodejs http or https module.
 *
 * @param url The url to fetch the data from.
 *
 * @returns json data from the url.
 */
export async function crossFetch<T>(url: string): Promise<T> {
  if (isBrowser()) {
    const response = await fetch(url);
    return await response.json();
  } else {
    return await nodeFetch<T>(url);
  }
}

function nodeFetch<T>(url: string): Promise<T> {
  const protocol = url.startsWith("https") ? "https" : "http";
  const http = require(protocol); // eslint-disable-line

  return new Promise((resolve, reject) => {
    http.get(url, (response: any) => {
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
  });
}
