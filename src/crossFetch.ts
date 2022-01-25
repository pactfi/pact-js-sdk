export async function crossFetch(url: string): Promise<any> {
  if (isBrowser()) {
    const response = await fetch(url);
    return await response.json();
  } else {
    return await nodeFetch(url);
  }
}

function nodeFetch(url: string): Promise<any> {
  const http = require("http"); // eslint-disable-line
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

function isBrowser(): boolean {
  return typeof window !== "undefined";
}
