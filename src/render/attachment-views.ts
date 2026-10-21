type Texture={createView(descriptor?:object):any};

/** Only the renderer's owned render attachments use this cache. Sampling views
 * and the current presentation texture have separate ownership and descriptors. */
export class RenderAttachmentViews{
  private defaults=new WeakMap<Texture,any>();
  private spots=new WeakMap<Texture,[any?,any?]>();
  private probes=new WeakMap<Texture,[any?,any?,any?,any?,any?,any?]>();
  private epoch=0;

  default(texture:Texture):any{
    const cached=this.defaults.get(texture);if(cached!==undefined)return cached;
    const epoch=this.epoch,view=texture.createView();
    if(epoch===this.epoch)this.defaults.set(texture,view);
    return view;
  }
  spot(texture:Texture,slot:number):any{
    const slots=this.spots.get(texture),cached=slots?.[slot];
    if(cached!==undefined)return cached;
    const epoch=this.epoch,view=texture.createView({dimension:'2d',baseArrayLayer:slot,arrayLayerCount:1});
    // The renderer has two spot shadow layers. Unexpected slots keep the old
    // GPU validation behavior without making this fixed cache grow.
    if(epoch===this.epoch&&(slot===0||slot===1)){
      const current=this.spots.get(texture)??[undefined,undefined];current[slot]=view;this.spots.set(texture,current);
    }
    return view;
  }
  probe(texture:Texture,face:number):any{
    const slots=this.probes.get(texture),cached=slots?.[face];
    if(cached!==undefined)return cached;
    const epoch=this.epoch,view=texture.createView({dimension:'2d',baseArrayLayer:face,arrayLayerCount:1,baseMipLevel:0,mipLevelCount:1});
    if(epoch===this.epoch&&Number.isInteger(face)&&face>=0&&face<6){
      const current=this.probes.get(texture)??[undefined,undefined,undefined,undefined,undefined,undefined];current[face]=view;this.probes.set(texture,current);
    }
    return view;
  }
  forget(texture:Texture):void{
    ++this.epoch;this.defaults.delete(texture);this.spots.delete(texture);this.probes.delete(texture);
  }
  clear():void{
    ++this.epoch;this.defaults=new WeakMap();this.spots=new WeakMap();this.probes=new WeakMap();
  }
}
