import { createApp } from "vue";
import App from "./App.vue";
import DesignSpike from "./DesignSpike.vue";
import "./style.css";

const isDesignSpike = new URLSearchParams(window.location.search).get("mode") === "design-spike";
createApp(isDesignSpike ? DesignSpike : App).mount("#app");
