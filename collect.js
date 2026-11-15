/* Runs in the source tab's isolated world. Blob URLs belong to their creating page. */
(() => {
  const clips = new Map();
  const descriptors = [];
  function visit(node) {
    for (const el of node.querySelectorAll("*")) {
      if (el.localName === "video" || el.localName === "img") {
        const source = el.querySelector("source[src],source[data-src]");
        const raw = el.currentSrc || el.getAttribute("src") || source?.getAttribute("src")
          || el.dataset.src || source?.dataset.src;
        const id = descriptors.length;
        let url = "";
        try { if (raw) url = new URL(raw, el.baseURI).href; } catch {}
        const transfer = /^(blob:|data:)/i.test(url);
        if (transfer) clips.set(id, {url, win:el.ownerDocument.defaultView});
        descriptors.push({id, kind:el.localName, transfer, url:transfer ? "" : url, stream:!!el.srcObject});
      }
      if (el.shadowRoot) visit(el.shadowRoot);
      if (el.localName === "iframe") { try { if (el.contentDocument) visit(el.contentDocument); } catch {} }
    }
  }
  visit(document);
  const session = Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
  globalThis.__syncClipReader = async (key, id, offset) => {
    if (key !== session || !clips.has(id)) throw Error("来源页已重新抓取");
    const item = clips.get(id);
    item.blob ||= item.win.fetch(item.url).then(r => {
      if (!r.ok) throw Error("读取临时素材失败");
      return r.blob();
    });
    const blob = await item.blob;
    const chunk = blob.slice(offset, offset+1024*1024);
    const data = await new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(chunk);
    });
    if (offset+chunk.size >= blob.size) clips.delete(id);
    return {data,size:blob.size,type:blob.type};
  };
  return {session, descriptors};
})();


