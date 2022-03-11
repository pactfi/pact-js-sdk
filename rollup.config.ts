import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "rollup-plugin-node-resolve";
import { terser } from "rollup-plugin-terser";

import pkg from "./package.json";

const input = "src/index.ts";

const external = ["algosdk", "decimal.js", "buffer"];

export default [
  {
    // UMD
    input,
    plugins: [
      typescript(),
      commonjs(),
      nodeResolve({ preferBuiltins: false }),
      terser(),
    ],
    output: {
      file: `dist/browser/${pkg.name}.min.js`,
      format: "umd",
      name: "pactsdk",
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
      dir: "dist/esm",
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
      file: `dist/cjs/${pkg.name}.js`,
      format: "cjs",
      exports: "named",
      sourcemap: true,
    },
    external,
  },
];
