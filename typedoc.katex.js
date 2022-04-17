const { JSX } = require("typedoc");

exports.load = function (app) {
    app.renderer.hooks.on("head.end", () => {
        return JSX.createElement(JSX.Fragment, null,
            JSX.createElement("link", { rel: "stylesheet", href: "https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.css", integrity: "sha384-R4558gYOUz8mP9YWpZJjofhk+zx0AS11p36HnD2ZKj/6JR5z27gSSULCNHIRReVs", crossorigin: "anonymous" },
                JSX.createElement("script", { defer: true, src: "https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/katex.min.js", integrity: "sha384-z1fJDqw8ZApjGO3/unPWUPsIymfsJmyrDVWC8Tv/a1HeOtGmkwNd/7xUS0Xcnvsx", crossorigin: "anonymous" }),
                JSX.createElement("script", { defer: true, src: "https://cdn.jsdelivr.net/npm/katex@0.15.1/dist/contrib/auto-render.min.js", integrity: "sha384-+XBljXPPiv+OzfbB3cVmLHf4hdUFHlWNZN5spNQ7rmHTXpd7WvJum6fIACpNNfIR", crossorigin: "anonymous", onload: "renderMathInElement(document.body);" })),
            "}); }");
    });
}