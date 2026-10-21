import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/** panel.html 的唯一 React 挂载点；StrictMode 仅用于开发期发现副作用。 */
const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount point");
createRoot(root).render(<StrictMode><App /></StrictMode>);
