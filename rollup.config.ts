import typescript from "@rollup/plugin-typescript";
import nodeResolve from "rollup-plugin-node-resolve";
import { terser } from "rollup-plugin-terser";

import pkg from "./package.json";

const input = "src/index.ts";

const external = ["algosdk", "decimal.js"];

export default [
  {
    // UMD
    input,
    plugins: [typescript(), nodeResolve(), terser()],
    output: {
      file: `dist/${pkg.name}.min.js`,
      format: "umd",
      name: pkg.name,
      esModule: false,
      exports: "named",
      sourcemap: true,
      globals: {
        algosdk: "algosdk",
        "decimal.js": "decimal",
      },
    },
    external: ["algosdk"],
  },

  // ESM
  {
    input,
    plugins: [typescript()],
    output: {
      dir: "dist",
      format: "esm",
      exports: "named",
      sourcemap: true,
    },
    external,
  },

  // CJS
  {
    input,
    plugins: [typescript()],
    output: {
      file: `dist/${pkg.name}.cjs`,
      format: "cjs",
      exports: "named",
      sourcemap: true,
    },
    external,
  },
];
