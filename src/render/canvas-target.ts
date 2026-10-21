/** CSS viewport values belong to the host. A worker host updates this same
 * object before rendering; it does not need document/window substitutes. */
export interface EngineCanvasViewport{
  cssWidth:number;
  cssHeight:number;
  pixelRatio:number;
}
export interface EngineCanvasTarget{
  readonly canvas:HTMLCanvasElement|OffscreenCanvas;
  readonly viewport:EngineCanvasViewport;
  /** Resolve authored material fetch URLs against the host document, while
   * preserving their authored cache/retention identities. */
  readonly assetBase?:string;
  /** Return a real, correctly sized Canvas2D backing surface. Fonts (including
   * the renderer's Georgia labels) must be ready in the caller's realm. */
  createLabelCanvas(width:number,height:number):HTMLCanvasElement|OffscreenCanvas;
}

/** Keep DOM reads lazy, in the same order as the original renderer: DPR on
 * resize, CSS dimensions only when no explicit render resolution was set. */
export function htmlCanvasTarget(canvas:HTMLCanvasElement):EngineCanvasTarget{
  const assetBase=typeof document==='undefined'?undefined:document.baseURI;
  return{
    canvas,
    ...(assetBase!==undefined?{assetBase}:{}),
    viewport:{
      get cssWidth(){return canvas.clientWidth;},
      get cssHeight(){return canvas.clientHeight;},
      get pixelRatio(){return devicePixelRatio;},
    },
    createLabelCanvas(width,height){const raster=document.createElement('canvas');raster.width=width;raster.height=height;return raster;},
  };
}
