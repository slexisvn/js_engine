import { getPayload } from "../../core/value/index.js";

export const PROXY_HIDDEN_CLASS = {
  id: -100,
  version: 0,
  isDeprecated: false,
  properties: new Map(),
  lookupProperty() {
    return null;
  },
  hasProperty() {
    return false;
  },
  incrementObjectCount() {},
  decrementObjectCount() {},
};

export class JSProxy {
  constructor(target, handler) {
    this.hiddenClass = PROXY_HIDDEN_CLASS;
    this.hiddenClass.incrementObjectCount();
    this.target = target;
    this.handler = handler;
    this.prototype = null;
    this.gcHeader = null;
    this.isProxy = true;
  }

  visitReferences(callback) {
    for (const val of [this.target, this.handler]) {
      const payload = getPayload(val);
      if (payload && typeof payload === "object" && payload.gcHeader) {
        callback(payload);
      }
    }
  }

  getMapId() {
    return this.hiddenClass.id;
  }
}

export function isJSProxyObject(obj) {
  return obj instanceof JSProxy || !!(obj && obj.isProxy === true);
}
