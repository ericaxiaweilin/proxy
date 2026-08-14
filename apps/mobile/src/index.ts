import { registerRootComponent } from "expo";
import { ProxyApp } from "./native-app";

export * from "./demand-client";
export * from "./requester-experience";

registerRootComponent(ProxyApp);
