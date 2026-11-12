/* Preserve the binary values supported by VS Code webview messages across JSON IPC. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.__DEVYY_EXTENSION_MESSAGES__ = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const constructors = new Set([
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
    "DataView",
  ]);
  function encode(value, seen = new Set()) {
    if (value === null || typeof value !== "object") return value;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const bytes =
        value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      let base64;
      if (typeof Buffer !== "undefined")
        base64 = Buffer.from(bytes).toString("base64");
      else {
        let text = "";
        for (let i = 0; i < bytes.length; i += 8192)
          text += String.fromCharCode(...bytes.subarray(i, i + 8192));
        base64 = btoa(text);
      }
      return {
        __devyy_binary_v1__:
          value instanceof ArrayBuffer
            ? "ArrayBuffer"
            : typeof Buffer !== "undefined" && Buffer.isBuffer(value)
              ? "Uint8Array"
              : value.constructor.name,
        base64,
      };
    }
    if (seen.has(value))
      throw new TypeError(
        "Webview messages cannot contain circular references",
      );
    seen.add(value);
    if (value.toJSON) {
      const result = encode(value.toJSON(), seen);
      seen.delete(value);
      return result;
    }
    const result = Array.isArray(value)
      ? value.map((item) => encode(item, seen))
      : Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, encode(item, seen)]),
        );
    seen.delete(value);
    return result;
  }
  function decode(value) {
    if (!value || typeof value !== "object") return value;
    const type = value.__devyy_binary_v1__;
    if (
      typeof type === "string" &&
      typeof value.base64 === "string" &&
      (type === "ArrayBuffer" || constructors.has(type))
    ) {
      const bytes =
        typeof Buffer !== "undefined"
          ? Uint8Array.from(Buffer.from(value.base64, "base64"))
          : Uint8Array.from(atob(value.base64), (char) => char.charCodeAt(0));
      if (type === "ArrayBuffer") return bytes.buffer;
      return new globalThis[type](bytes.buffer);
    }
    return Array.isArray(value)
      ? value.map(decode)
      : Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, decode(item)]),
        );
  }
  return { encode, decode };
});
