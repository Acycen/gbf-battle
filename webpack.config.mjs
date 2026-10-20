import path from "node:path";
import { fileURLToPath } from "node:url";
import CopyPlugin from "copy-webpack-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";
import MiniCssExtractPlugin from "mini-css-extract-plugin";

const root = path.dirname(fileURLToPath(import.meta.url));

export default (environment = {}, argv = {}) => ({
  mode: argv.mode === "production" ? "production" : "development",
  entry: {
    background: "./src/background/index.ts",
    content: "./src/content/index.ts",
    page: "./src/page/index.ts",
    panel: "./src/panel/index.tsx"
  },
  output: {
    path: path.join(root, environment.release ? ".release-dist" : "dist"),
    filename: "[name].js",
    clean: true
  },
  devtool: environment.release ? false : "source-map",
  resolve: { extensions: [".ts", ".tsx", ".js"] },
  module: {
    rules: [
      { test: /\.tsx?$/u, exclude: /node_modules/u, use: "ts-loader" },
      { test: /\.css$/u, use: [MiniCssExtractPlugin.loader, "css-loader"] }
    ]
  },
  plugins: [
    new CopyPlugin({ patterns: [{ from: "public", to: "." }] }),
    new HtmlWebpackPlugin({ template: "src/panel/index.html", filename: "panel.html", chunks: ["panel"] }),
    new MiniCssExtractPlugin({ filename: "[name].css" })
  ],
  // Manifest 直接引用入口；四个执行环境各自独立，不共享运行时 chunk。
  optimization: { runtimeChunk: false, splitChunks: false }
});
