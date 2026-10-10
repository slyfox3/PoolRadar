const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const html=fs.readFileSync('wbca_2026.html','utf8'),snapshot=JSON.parse(fs.readFileSync('wbca_2026-search.json'));
function extract(name){const a=html.indexOf('  function '+name+'('),b=html.indexOf('\n  }',a);assert(a>=0);return html.slice(a,b+4);}
const functions=['validSearchCache','saveSearchCache','applySearchCache','bracketSignature','refreshDivisions','loadSearchData'].map(extract).join('\n');
async function scenario(initial,storageError=false,networkError=false){
 let stored=initial,calls=[],built=0,frames=0,rendered=false;
 const c={players:[],registrationEntries:[],divisionData:{divisions:[]},searchReady:false,SEARCH_CACHE_KEY:'cache',base:'',requestAnimationFrame:callback=>{frames++;callback();},render:()=>{rendered=true;},renderSearch:()=>{},document:{getElementById:()=>({})},localStorage:{getItem:()=>{if(storageError)throw Error('disabled');return stored;},setItem:(k,v)=>{if(storageError)throw Error('quota');stored=v;}},fetch:async url=>{calls.push(url);if(url==='wbca_2026-search.json'){assert(rendered);assert.equal(frames,2);}if(networkError&&url!=='wbca_2026-search.json')throw Error('offline');return {ok:true,json:async()=>structuredClone(url==='wbca_2026-search.json'?snapshot:url==='wbca_2026-divisions.json'?JSON.parse(fs.readFileSync('wbca_2026-divisions.json')):snapshot.divisionData)};},loadPlayers:()=>{built++;}};
 vm.createContext(c);vm.runInContext(functions,c);await c.loadSearchData();return {c,calls,built,stored};
}
(async()=>{
 const first=await scenario(null);assert(first.c.searchReady);assert.equal(first.c.players.length,snapshot.players.length);assert.deepEqual(first.calls,['wbca_2026-divisions.json','wbca_2026-search.json','/bracketbeast/tournament/53/divisions']);assert.equal(first.built,0);assert(JSON.parse(first.stored).entries.length===snapshot.entries.length);
 const repeat=await scenario(first.stored);assert.deepEqual(repeat.calls,['/bracketbeast/tournament/53/divisions']);assert(repeat.c.searchReady);assert.equal(repeat.built,0);
 const corrupt=await scenario('{broken');assert(corrupt.c.searchReady);assert(corrupt.calls.includes('wbca_2026-search.json'));
 const noStorage=await scenario(null,true);assert(noStorage.c.searchReady);assert.equal(noStorage.c.players.length,snapshot.players.length);
 const offline=await scenario(first.stored,false,true);assert(offline.c.searchReady);assert.equal(offline.c.players.length,snapshot.players.length);
 console.log('Cache paths verified: first visit, repeat visit, corrupt cache, storage unavailable, background offline.');
})();
