/** Prefer the specific named entity when aliases overlap in the same span.
 * Separate mentions remain separate; identical aliases remain ambiguous. */
export function resolveEntityMentions(text:string,entities:{id:string;name:string;aliases:string[]}[]) {
 const value=text.toLowerCase(),hits:{id:string;start:number;end:number}[]=[];
 for(const entity of entities)for(const raw of [entity.name,...entity.aliases]) {
  const alias=raw.toLowerCase();if(!alias)continue;
  let from=0,at:number;
  while((at=value.indexOf(alias,from))>=0){from=at+alias.length;const end=at+alias.length;
   if((at===0||!/[a-z0-9]/i.test(value[at-1]))&&(end===value.length||!/[a-z0-9]/i.test(value[end])))hits.push({id:entity.id,start:at,end});
  }
 }
 return [...new Set(hits.filter(h=>!hits.some(other=>other.id!==h.id&&other.start<=h.start&&other.end>=h.end&&other.end-other.start>h.end-h.start)).map(h=>h.id))].slice(0,8);
}
