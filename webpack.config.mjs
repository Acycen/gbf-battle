import path from "node:path";
import { fileURLToPath } from "node:url";
import CopyPlugin from "copy-webpack-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";
import MiniCssExtractPlugin from "mini-css-extract-plugin";

const root = path.dirname(fileURLToPath(import.meta.url));

/** 四个 Manifest 执行环境保持独立入口，release 构建额外关闭 source map。 */
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
    // React.lazy 产生的面板子视图必须是扩展包内的稳定本地文件名。
    chunkFilename: "[name].js",
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
