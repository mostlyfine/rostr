import { render } from "hono/jsx/dom";
import { App } from "./App";
import "./style.css";

render(<App />, document.getElementById("app")!);
