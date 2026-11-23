// 実行できる枠（html-app）の文書に、AI の中身より前に差し込む「橋」と「土台のスタイル」（F28・F40）。文字列を作る、純粋な関数だけ（`appframe.ts` が使う）。
// 橋は、枠と画面の、狭い通信路：枠 → 画面は `resize`（高さ）だけ・画面 → 枠は `theme`（ライト／ダーク）だけ。どちらも、`postMessage`。
// 枠は、オリジンのない文書（sandbox に allow-same-origin がない）なので、送り先のオリジンは、指定できない（`'*'`）。送るのは、高さだけ（秘密ではない）。
// **受ける側（画面）が、送り元の窓（`contentWindow`）で、検査する**（apps の `appBridge.ts`）。枠が受けるのも、`e.source === parent` と、値の形を確かめてから。
// **土台のスタイル・画面の外観への追従は、中身が、対応を示したときだけ**（`shared/htmlapp-theme.ts` の `followsTheme`：オプトイン）。
// 示さない資料（従来の、自分で全部書いたもの）には、**橋のスクリプトだけ**を足す（土台なし・`data-theme` なし・`color-scheme` なし：常に、従来のライトの見た目）。
// 隔離（`APP_CSP`）は、変えない：インラインのスクリプト・スタイルは、すでに許されている。外への通信を足さない。
import { SNAPSHOT_MAX_SIDE, STATE_MAX_BYTES, STYLE_KEYS } from '../shared/htmlapp-bridge';
import { bridgeColorDecls, followsTheme } from '../shared/htmlapp-theme';

export type FrameMode = 'light' | 'dark';

/**
 * クエリ `?mode=` の検査：`light` か `dark` が、ちょうど 1 つのときだけ。それ以外（なし・空・別の文字・複数）は、指定なし（null）。
 * 文書へ埋め込むのは、ここを通った 2 つの定数だけ（クエリの文字列を、そのまま入れない）
 */
export const parseMode = (values: readonly string[] | undefined): FrameMode | null =>
  values?.length === 1 && (values[0] === 'light' || values[0] === 'dark') ? values[0] : null;

// 土台のスタイル（オプトインした資料だけ）。**すべて `:where()`（詳細度 0）**：AI の CSS が、いつも勝つ。AI が自分で全部書いた従来の資料は、見た目を変えない
// （従来は、背景が透明〔白〕・文字は黒。ライトの土台も、白地・ほぼ黒の文字）。配色は、画面の app.css のトークンと、同じ意味・近い値。
// `--color-accent-ink` は、リンクなど「文字に使う」アクセント。白い文字を載せる塗りは `--color-accent-fill`（どちらの外観でも、白で読める）
export const BASE_STYLE = `
:where(:root){color-scheme:light dark;
${bridgeColorDecls()};
--font-sans:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","Segoe UI",sans-serif;--font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--radius:6px}
:where(:root[data-theme="light"]){color-scheme:light}
:where(:root[data-theme="dark"]){color-scheme:dark}
:where(body){margin:0;padding:12px;box-sizing:border-box;background:var(--color-bg);color:var(--color-ink);font:14px/1.6 var(--font-sans)}
:where(a){color:var(--color-accent-ink)}
:where(code,pre,kbd,samp){font-family:var(--font-mono)}
:where(button,select,textarea,input:not([type="checkbox"],[type="radio"],[type="range"],[type="color"],[type="file"])){font:inherit;color:var(--color-ink);background:var(--color-surface);border:1px solid light-dark(#d4d4d8,#52525b);border-radius:var(--radius);padding:4px 10px;box-sizing:border-box}
:where(select,textarea,input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"],[type="range"],[type="color"],[type="file"])){background:var(--color-bg)}
:where(button){cursor:pointer}
:where(button:hover:not(:disabled)){background:var(--color-line)}
:where(button:disabled){cursor:default;opacity:.5}
:where(input[type="checkbox"],input[type="radio"],input[type="range"]){accent-color:var(--color-accent)}
`
  .trim()
  .replace(/\n/g, '');

// 橋のスクリプト（ブラウザで動く。`</script` を含めない。試験は、この本物のコードを、疑似の窓で動かす）。
// 高さ：`ResizeObserver`（html・body）・読み込み・フォント・数回の遅延で、body の高さ（上の余白・下の余白を含める）を測り、`resize` を送る。
// **揺れ防止**（スクロールバーの出入りで、幅が変わって、折り返しが変わる・`100vh` や `%` の高さで、枠の高さが、そのまま中身の高さになる、など）：
//   - 報告は、250ms に 1 回まで（測るのは、まとめて、遅らせる。測りも 50ms に 1 回まで）。1 秒に、数回を超えない。
//   - 1 秒以内の往復（A → B → A → B …）が、**私たちが枠の高さを変えた直後**（`innerHeight` が、前の測りから変わった）に、2 回続いたら、**大きい方（B）に留まる**
//     （小さい方 A へ戻る報告を、10 秒間、しない。A 以外の値への変化は、ふつうに知らせる）。1 回だけ戻る（利用者が、開いて、すぐ閉じた）のは、ふつうに知らせる。
//   - 枠の高さを変えると、中身が、同じだけ（`100vh` + 余白）伸びる循環は、増えかたが同じ（2 回）続いたら、**最後に測った高さ（大きい側）を、1 回報告して、止める**。
//     止めたあと、**超える分が小さい**（枠の高さに追従する余白だけ：SLACK=64px 以下・報告する高さが上限 MAXH=2400 〔画面の上限と同じ〕以下）ときだけ、枠の中の縦のスクロールバーが出ないよう、
//     `overflow-y: hidden` にする。**それより大きい**（`100vh` のヒーローの下に、本物の節が続く）ときは、`auto`（枠の中を、スクロールして、全部読める）。止めたあとの、同じ増えかたは、無視する。
// 画面からの `theme`：`e.source === parent`・`mode` が 2 つの値・`by` が 2 つの値のどちらか、のときだけ。`by: 'auto'`（画面の外観の変化）は、
// 資料が対応を示した枠（サーバーが付けた `<html data-follow>`）だけ。`by: 'user'`（ツールバー：利用者の明示の操作）は、どの枠でも効く。
// 効くときは、`<html data-theme>` と `color-scheme` を更新する（再読み込みしない。枠の中の状態は、保たれる）。
// 枠の中の資料は、`data-theme` の変化（`MutationObserver`）や、`color-scheme` で、色を合わせられる
export const BRIDGE_SOURCE = `(function(){
var GAP=250,STEP=50,FLIP=1000,HOLD=10000,ECHO=2,SLACK=64,MAXH=2400;
var root=document.documentElement;
// 選択モードで、イベントを止める関数は、**このスクリプトが動いた時点の本物**を、退避して使う（中身のコードが、あとから Event.prototype の関数を置き換えても、止められる）
var PD=Event.prototype.preventDefault,SIP=Event.prototype.stopImmediatePropagation;
var last=0,prev=0,prevAt=0,lastAt=-GAP,ranAt=0,timer=0,echo=0,seenH=innerHeight,lastExcess=-1,flipLow=0,flipUntil=0,flips=0,frozen=false,frozenExcess=0,excess=0;
function measure(){
var b=document.body;
if(!b)return 0;
var top=Math.max(0,b.getBoundingClientRect().top+scrollY);
return Math.ceil(top+b.scrollHeight+(parseFloat(getComputedStyle(b).marginBottom)||0));
}
function send(h,now){
prev=last;prevAt=lastAt;last=h;lastAt=now;
if(parent!==window)parent.postMessage({__rikai:1,type:'resize',height:h},'*');
}
function update(){
timer=0;
var now=Date.now();
ranAt=now;
var m=measure();
if(m<=0)return;
var driven=innerHeight!==seenH;
seenH=innerHeight;
if(m===last)return;
if(frozen){
if(m>last&&m-innerHeight===frozenExcess)return;
frozen=false;root.style.overflowY='';echo=0;lastExcess=-1;
}
if(m>last){
excess=m-innerHeight;
echo=driven&&excess>0&&excess===lastExcess?echo+1:0;
lastExcess=excess;
}else echo=0;
if(echo>=ECHO){frozen=true;frozenExcess=excess;root.style.overflowY=excess<=SLACK&&m<=MAXH?'hidden':'auto';send(m,now);return;}
if(m<last&&m===flipLow&&now<flipUntil)return;
flips=m===prev&&driven&&now-prevAt<FLIP?flips+1:0;
if(flips>=2&&m<last){flipLow=m;flipUntil=now+HOLD;return;}
send(m,now);
}
function request(){
if(timer)return;
var wait=Math.max(lastAt+GAP,ranAt+STEP)-Date.now();
timer=setTimeout(update,wait>0?wait:0);
}
if(typeof ResizeObserver==='function'){
var ro=new ResizeObserver(request);
ro.observe(root);
document.addEventListener('DOMContentLoaded',function(){if(document.body)ro.observe(document.body);request();});
}
addEventListener('load',request);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(request);
[100,500,1500].forEach(function(t){setTimeout(request,t);});
var inFrame=parent!==window;
var STYLES=${JSON.stringify(STYLE_KEYS)},STATE_MAX=${STATE_MAX_BYTES},SGAP=250;
function post(m){if(inFrame)parent.postMessage(m,'*');}
var lastState=null,pendingState=null,stateTimer=0,stateAt=0;
function sendState(){
stateTimer=0;
var j=pendingState;
pendingState=null;
if(j===null||j===lastState)return;
lastState=j;
stateAt=Date.now();
post({__rikai:1,type:'state',json:j});
}
function setState(obj){
var j;
try{j=JSON.stringify(obj);if(typeof obj!=='object'||obj===null||typeof j!=='string'||new TextEncoder().encode(j).length>STATE_MAX)return false;}catch(e){return false;}
pendingState=j;
if(!stateTimer)stateTimer=setTimeout(sendState,Math.max(0,stateAt+SGAP-Date.now()));
return true;
}
Object.defineProperty(window,'rikai',{value:Object.freeze({state:setState})});
var picking=false,hl=null;
function esc(s){return typeof CSS==='object'&&CSS.escape?CSS.escape(s):String(s).replace(/[^a-zA-Z0-9_-]/g,'\\$&');}
function part(el){
var t=el.tagName.toLowerCase();
if(el.id)return t+'#'+esc(el.id);
var s=t,cl=el.classList;
for(var i=0;i<cl.length&&i<2;i++)s+='.'+esc(cl[i]);
var p=el.parentElement;
if(p){
var same=0,idx=0;
for(var c=p.firstElementChild;c;c=c.nextElementSibling){if(c.tagName===el.tagName){same++;if(c===el)idx=same;}}
if(same>1)s+=':nth-of-type('+idx+')';
}
return s;
}
function selectorOf(el){
var sel=part(el),cur=el;
for(var d=0;d<4;d++){
try{if(document.querySelectorAll(sel).length===1)break;}catch(e){break;}
cur=cur.parentElement;
if(!cur||cur===document.documentElement)break;
sel=part(cur)+' > '+sel;
}
return sel.slice(0,200);
}
function describe(el){
var r=el.getBoundingClientRect(),cs=getComputedStyle(el),st={};
for(var i=0;i<STYLES.length;i++){var v=cs.getPropertyValue(STYLES[i]);if(v)st[STYLES[i]]=String(v).slice(0,80);}
return{__rikai:1,type:'pick',selector:selectorOf(el),tag:el.tagName.toLowerCase(),
text:(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80),
rect:{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)},
styles:st,frame:{w:Math.round(innerWidth),h:Math.round(innerHeight)}};
}
function pickEnd(){
picking=false;
if(hl&&hl.parentNode)hl.parentNode.removeChild(hl);
hl=null;
}
function pickStart(){
if(picking)return;
picking=true;
hl=document.createElement('div');
hl.setAttribute('data-rikai-pick','');
hl.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;border:2px solid #2563eb;background:rgba(37,99,235,.12);left:0;top:0;width:0;height:0';
document.documentElement.appendChild(hl);
}
function hover(e){
var t=e.target;
if(!picking||!hl||!t||t.nodeType!==1||t===hl)return;
var r=t.getBoundingClientRect();
hl.style.left=r.left+'px';hl.style.top=r.top+'px';hl.style.width=r.width+'px';hl.style.height=r.height+'px';
}
function block(e){
if(!picking)return;
if(e.type==='keydown'&&e.key==='Escape'){PD.call(e);SIP.call(e);pickEnd();post({__rikai:1,type:'pick-cancel'});return;}
PD.call(e);
SIP.call(e);
if(e.type==='click'){
var t=e.target;
if(!t||t.nodeType!==1||t===hl)return;
var m=describe(t);
pickEnd();
post(m);
}
}
['click','dblclick','auxclick','mousedown','mouseup','pointerdown','pointerup','touchstart','touchend','contextmenu','submit','keydown','keypress','keyup','dragstart'].forEach(function(t){addEventListener(t,block,{capture:true,passive:false});});
var SNAP_SIDE=${SNAPSHOT_MAX_SIDE},SNAP_CHARS=1500000,SNAP_NODES=3000;
function snapshot(id){
var fin=false,timer=0;
function done(png){if(fin)return;fin=true;clearTimeout(timer);post({__rikai:1,type:'snapshot',id:id,png:png});}
timer=setTimeout(function(){done(null);},1500);
try{
var b=document.body,W=Math.min(SNAP_SIDE,Math.round(innerWidth)),H=Math.min(SNAP_SIDE,Math.round(innerHeight));
if(!b||!(W>0)||!(H>0)||document.getElementsByTagName('*').length>SNAP_NODES){done(null);return;}
var bg=getComputedStyle(root).backgroundColor;
if(!bg||bg==='rgba(0, 0, 0, 0)'||bg==='transparent')bg=getComputedStyle(b).backgroundColor;
var box=document.createElement('div');
box.setAttribute('xmlns','http://www.w3.org/1999/xhtml');
box.style.cssText='position:relative;overflow:hidden;width:'+W+'px;height:'+H+'px;background:'+(bg||'transparent');
var src=[b].concat([].slice.call(b.querySelectorAll('*'))),c=b.cloneNode(true),dst=[c].concat([].slice.call(c.querySelectorAll('*'))),drop=[];
for(var i=0;i<src.length;i++){
var s=src[i],d=dst[i];
if(!s||!d)continue;
var cs=getComputedStyle(s),css='';
for(var j=0;j<cs.length;j++)css+=cs[j]+':'+cs.getPropertyValue(cs[j])+';';
d.setAttribute('style',css+'outline:none;');
var t=String(d.tagName).toLowerCase();
if(t==='script'||t==='style'||t==='iframe'||t==='video'||t==='audio'||t==='object'||t==='embed'||t==='link')drop.push(d);
else if(t==='input')d.setAttribute('value',String(s.value));
else if(t==='textarea')d.textContent=String(s.value);
else if(t==='img'){d.removeAttribute('srcset');if(!/^data:/i.test(d.getAttribute('src')||''))d.removeAttribute('src');}
}
drop.forEach(function(d){if(d.parentNode)d.parentNode.removeChild(d);});
var r=b.getBoundingClientRect(),pos={position:'absolute',margin:'0','box-sizing':'border-box',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'};
for(var k in pos)c.style.setProperty(k,pos[k],'important');
box.appendChild(c);
var xml=new XMLSerializer().serializeToString(box).replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]/g,'');
if(xml.length>40000000){done(null);return;}
var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'"><foreignObject x="0" y="0" width="'+W+'" height="'+H+'">'+xml+'</foreignObject></svg>';
var im=new Image();
im.onload=function(){
try{
var cv=document.createElement('canvas'),g;
cv.width=W;cv.height=H;
g=cv.getContext('2d');g.drawImage(im,0,0,W,H);
var u=cv.toDataURL('image/png');
if(u.length>SNAP_CHARS){
cv.width=Math.round(W/2);cv.height=Math.round(H/2);
g=cv.getContext('2d');g.drawImage(im,0,0,cv.width,cv.height);
u=cv.toDataURL('image/png');
if(u.length>SNAP_CHARS)u=null;
}
done(u);
}catch(e){done(null);}
};
im.onerror=function(){done(null);};
im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}catch(e){done(null);}
}
addEventListener('mousemove',hover,true);
addEventListener('message',function(e){
var d=e.data;
if(e.source!==parent||!d||d.__rikai!==1)return;
if(d.type==='pick-start'){pickStart();return;}
if(d.type==='pick-cancel'){pickEnd();return;}
if(d.type==='snapshot-req'){if(typeof d.id==='string'&&/^s[0-9]{1,9}$/.test(d.id))snapshot(d.id);return;}
if(d.type!=='theme')return;
if(d.mode!=='light'&&d.mode!=='dark')return;
if(d.by!=='auto'&&d.by!=='user')return;
if(d.by==='auto'&&!root.hasAttribute('data-follow'))return;
root.setAttribute('data-theme',d.mode);
root.style.colorScheme=d.mode;
});
})();`;

/**
 * 枠の文書。**対応を示した中身**（`followsTheme`）：doctype・`<html data-follow data-theme?>`（mode があるときだけ data-theme）・文字コード・土台のスタイル・橋・AI の中身（そのまま、最後）。
 * **示さない中身**：doctype・文字コード・橋・中身だけ（従来の文書に、橋のスクリプトを足しただけ：土台・`<html>` の属性なし）。mode は、使わない。
 * `<head>` は、閉じない（従来の「文字コードのあとに、すぐ中身」と同じ構文木：中身の `<html>`・`<head>`・`<body>`・`<style>` は、これまでどおり、解釈される）
 */
export function frameDocument(content: string, mode: FrameMode | null): string {
  const bridge = `<script>${BRIDGE_SOURCE}</script>`;
  if (!followsTheme(content)) return `<!doctype html>\n<meta charset="utf-8">\n${bridge}\n${content}`;
  return `<!doctype html>\n<html data-follow${mode ? ` data-theme="${mode}"` : ''}>\n<meta charset="utf-8">\n<style>${BASE_STYLE}</style>\n${bridge}\n${content}`;
}
