package main

// instructions —— the booker capability's system-prompt fragment, served via MCP
// `instructions` (self-contained: the prompt ships with the plugin, not in core).
//
// The timezone paragraph moved here from the kernel's always-on datetime context
// (internal/conversation/inference/agent_instruction.go). That context is injected on
// every turn regardless of what the visitor was granted, and it used to say "for
// scheduling, the owner's calendar runs in this timezone" plus "confirm the visitor's
// timezone before proposing times" — so a visitor with nothing but corpus access
// carried a scheduling instruction for a tool they could not see. The kernel now states
// only facts (the current time, which zone it is in, and the visitor's zone when known);
// what to *do* about those zones is this capability's business, and it appears only when
// this capability is granted.
const instructions = `You can book meetings on the owner's Google Calendar. Two tools work together:

1. **calendar_list_slots** — search a time window and get back the free [start, end] slots that pass the owner's booking policy. Pass ` + "`from_rfc3339`" + `, ` + "`until_rfc3339`" + `, and ` + "`duration_min`" + `. Use this *before* offering times so you propose ones the owner actually has free.

2. **calendar_book** — actually create the event. Only call after you have gathered topic, duration (15-180 min), and one or more visitor-confirmed start times in RFC3339. You do not supply a recipient; the result tells you what happened. Read ` + "`invited_email`" + ` on the result and say exactly that: if it holds an address, the invite went there; **if it is empty, nobody was invited — say so plainly** ("no invite could be emailed, so keep a note of the time yourself") and offer the confirmation-email widget on the card. Never name an address the result did not give you, even one the visitor typed earlier in the conversation — an address in the transcript is not a recipient the booking used.

Default flow: ask topic + duration **and roughly when the visitor wants to meet** (a day or a window — don't guess it for them). Call calendar_list_slots for a window around what they asked for, present 2-3 of the available slots in their local time, wait for them to pick, then call calendar_book with that single confirmed time.

Timezones: the current date and time you were given runs in the **owner's** timezone — that is the zone the owner's calendar keeps. Interpret any time the visitor names in the visitor's own timezone, convert it to the owner's when you search or book, and state both the visitor-local and the owner-local time when you confirm. If you have not been told the visitor's timezone, ask for it before proposing times.

When the visitor's preferred time isn't free: don't keep hunting blindly. List the *nearest* available slots around what they asked and let them choose from those. Search at most a window or two near their request — if that comes back empty, tell the visitor plainly that there's nothing open in that period and ask them for a different timeframe to try. Never widen the search again and again (next week → next month → next year) or call calendar_list_slots over and over; a couple of empty windows means "ask the visitor for a new timeframe," not "search harder."`

// Card metadata —— calendar_list_slots declares this ui:// card on its tool
// `_meta.ui_resource`. The host reads it (resources/read) at assembly and renders
// it sandboxed: a collapsible day picker; clicking a time chip posts mcp-ui:submit
// ("book the … slot") which the host forwards as the next visitor turn.
//
// calendar_book declares the booked-confirmation card: time + GCal link + cancel
// button + "send confirmation email?" widget. Cancel / send dispatch via mcp-ui:tool
// (calendar_cancel / send_confirmation), the host runs the connector-backed op and
// posts mcp-ui:tool-result back so the card flips to cancelled / sent.
const (
	slotsCardURI   = "ui://booker/slots-card.html"
	bookedCardURI  = "ui://booker/booked-card.html"
	slotsCardMIME  = "text/html"
	bookedCardMIME = "text/html"
)

// slotsCardHTML —— the self-contained sandboxed slots picker. Receives the tool
// result {ok, slots:[{start,end}]} via mcp-ui:data, groups slots by day (visitor-
// local), renders day buttons + the selected day's time chips. A chip click posts
// mcp-ui:submit so the visitor picks a real free time in one tap.
const slotsCardHTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
 :root{font-family:ui-serif,Georgia,serif;color:#1B1814}
 body{margin:0;padding:2px}
 details{font:13px ui-serif,Georgia,serif}
 summary{cursor:pointer;list-style:none;padding:2px 0;user-select:none}
 summary::-webkit-details-marker{display:none}
 .kicker{font:600 12px ui-monospace,monospace;color:#6b5d4f}
 .cal{margin-top:8px;border-top:1px solid #d9d0c2;padding-top:8px}
 .days{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
 .day{padding:5px 9px;border:1px solid #1B1814;background:#F3EFE6;cursor:pointer;
   font:12px ui-monospace,monospace}
 .day[aria-pressed=true]{background:#B5391C;color:#fff;border-color:#B5391C}
 .times{display:flex;flex-wrap:wrap;gap:6px}
 .chip{padding:6px 10px;border:1px solid #1B1814;background:#F3EFE6;cursor:pointer;
   font:13px ui-serif,Georgia,serif}
 .chip:hover{background:#1B1814;color:#F3EFE6}
 .empty{margin-top:8px;color:#6b5d4f;font-size:12px}
</style></head><body>
<script>
(function(){
 var byDay={}, order=[], sel="";
 function h(){parent.postMessage({type:"mcp-ui:height",
   height:document.documentElement.scrollHeight+8},"*");}
 function fmtDay(d){return d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});}
 function fmtTime(d){return d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});}
 function dayKey(d){return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate();}
 function el(tag,cls,txt){var e=document.createElement(tag);
   if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e;}
 function group(slots){
   byDay={}; order=[];
   slots.forEach(function(s){
     var st=new Date(s.start); if(isNaN(st.getTime()))return;
     var k=dayKey(st);
     if(!byDay[k]){byDay[k]={label:fmtDay(st),items:[]}; order.push(k);}
     byDay[k].items.push({start:st,end:new Date(s.end)});
   });
 }
 function renderTimes(host){
   host.innerHTML="";
   var day=byDay[sel]; if(!day)return;
   day.items.forEach(function(it){
     var b=el("button","chip",fmtTime(it.start)+" – "+fmtTime(it.end));
     b.setAttribute("data-testid","tool-card-slot");
     b.onclick=function(){
       parent.postMessage({type:"mcp-ui:submit",
         value:"book the "+day.label+" at "+fmtTime(it.start)+" slot"},"*");
     };
     host.appendChild(b);
   });
 }
 function render(slots){
   group(slots);
   var det=el("details"); det.open=true;
   det.setAttribute("data-testid","tool-card-calendar_list_slots");
   var sum=el("summary");
   var kick=el("span","kicker","available · "+slots.length+" slots");
   kick.setAttribute("data-testid","bookings-kicker");
   sum.appendChild(kick); det.appendChild(sum);
   if(slots.length===0){
     det.appendChild(el("div","empty","no free slots in that window — try a different range."));
   } else {
     sel=order[0];
     var cal=el("div","cal"); cal.setAttribute("data-testid","slot-calendar");
     var days=el("div","days");
     order.forEach(function(k){
       var b=el("button","day",byDay[k].label);
       b.setAttribute("data-testid","slot-day");
       if(k===sel)b.setAttribute("aria-pressed","true");
       b.onclick=function(){
         sel=k;
         days.querySelectorAll("button").forEach(function(x){x.removeAttribute("aria-pressed");});
         b.setAttribute("aria-pressed","true"); renderTimes(times); h();
       };
       days.appendChild(b);
     });
     var times=el("div","times"); times.setAttribute("data-testid","slot-times");
     cal.appendChild(days); cal.appendChild(times);
     det.appendChild(cal); renderTimes(times);
   }
   det.addEventListener("toggle",h);
   document.body.innerHTML=""; document.body.appendChild(det);
 }
 window.addEventListener("message",function(e){
   if(e.data&&e.data.type==="mcp-ui:data"){
     var d=e.data.data||{}; render(Array.isArray(d.slots)?d.slots:[]); h();
   }
 });
 parent.postMessage({type:"mcp-ui:ready"},"*");
})();
</script></body></html>`

// bookedCardHTML —— calendar_book 成功后的「已约确认卡」（沙盒 iframe）。收 book 结果
// {ok,event_id,html_link,start,end}（mcp-ui:data）后渲：时间 + GCal 链接 + 取消按钮 +
// 「发确认邮件吗」widget。取消 / 发信经 mcp-ui:tool 派给 host（calendar_cancel /
// send_confirmation），host 跑连接器 op 后 post mcp-ui:tool-result 回来，卡据此翻到
// cancelled / sent。凭据全程在 host，卡断网只发协议消息。
const bookedCardHTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
 :root{font-family:ui-serif,Georgia,serif;color:#1B1814}
 body{margin:0;padding:2px}
 .card{font:13px ui-serif,Georgia,serif;border:1px solid #d9d0c2;padding:10px;background:#F3EFE6}
 .kicker{font:600 11px ui-monospace,monospace;color:#6b5d4f;text-transform:uppercase;letter-spacing:.05em}
 .time{font:600 15px ui-serif,Georgia,serif;margin:4px 0}
 .link{display:inline-block;margin:2px 0 8px;color:#B5391C;text-decoration:underline}
 .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px}
 button{padding:5px 10px;border:1px solid #1B1814;background:#F3EFE6;cursor:pointer;
   font:12px ui-monospace,monospace}
 button:hover:not(:disabled){background:#1B1814;color:#F3EFE6}
 button:disabled{opacity:.5;cursor:default}
 .prompt{margin-top:10px;border-top:1px solid #d9d0c2;padding-top:8px}
 .label{font:12px ui-serif,Georgia,serif;margin-bottom:6px}
 input{padding:5px 7px;border:1px solid #1B1814;background:#fff;font:12px ui-monospace,monospace;flex:1;min-width:120px}
 .err{margin-top:6px;color:#B5391C;font-size:12px}
 .muted{color:#6b5d4f}
 [data-cancelled=true] .time{text-decoration:line-through;color:#6b5d4f}
</style></head><body>
<script>
(function(){
 var seq=0, pending={}, statePending={};
 function h(){parent.postMessage({type:"mcp-ui:height",
   height:document.documentElement.scrollHeight+8},"*");}
 function el(tag,cls,txt){var e=document.createElement(tag);
   if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e;}
 function fmt(s,e){
   var a=new Date(s), b=new Date(e);
   if(isNaN(a.getTime()))return "";
   var d=a.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});
   var t=function(x){return x.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});};
   return d+" · "+t(a)+"–"+t(b);
 }
 function callTool(name,args,cb){
   var id="t"+(++seq); pending[id]=cb;
   parent.postMessage({type:"mcp-ui:tool",name:name,args:args,requestId:id},"*");
 }
 function tz(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||"";}catch(_){return "";}}
 function emailPrompt(d){
   var p=el("div","prompt"); p.setAttribute("data-testid","booking-email-prompt");
   p.setAttribute("data-sent","false");
   p.appendChild(el("div","label","Send a confirmation email?"));
   var row=el("div","row");
   var useProfile=el("button",null,"Use my email");
   useProfile.setAttribute("data-testid","booking-email-use-profile");
   var input=el("input"); input.setAttribute("data-testid","booking-email-other");
   input.placeholder="a different address";
   var sendTyped=el("button",null,"Send");
   sendTyped.setAttribute("data-testid","booking-email-send");
   var skip=el("button",null,"No thanks");
   skip.setAttribute("data-testid","booking-email-skip");
   skip.onclick=function(){
     p.setAttribute("data-sent","true");
     p.innerHTML=""; p.appendChild(el("div","label muted","no confirmation sent"));
     h();
   };
   function send(recipient,btns){
     btns.forEach(function(b){b.disabled=true;});
     // 进行中要**说出来**。这一步后端要起沙箱,空闲时 ~1s,机器压满时见过 19 秒 ——
     // 而在这行之前,访客看到的只有"按钮变灰",十几秒毫无动静。他会以为没点上、
     // 再点一次(幂等 marker 挡住了重复发信,但他看见的仍然是一个死掉的按钮)。
     var busy=el("div","label muted","sending…");
     busy.setAttribute("data-testid","booking-email-sending");
     p.appendChild(busy);
     function clearBusy(){ if(busy&&busy.parentNode) busy.parentNode.removeChild(busy); }
     callTool("send_confirmation",{recipient:recipient,tz:tz()},function(res){
       clearBusy();
       if(res&&res.ok){
         p.setAttribute("data-sent","true");
         p.innerHTML=""; p.appendChild(el("div","label muted","confirmation sent"));
       }else{
         btns.forEach(function(b){b.disabled=false;});
         var old=p.querySelector(".err"); if(old)old.remove();
         var em=el("div","err",(res&&(res.detail||res.error))||"couldn't send — try again");
         em.setAttribute("data-testid","booking-email-error");
         p.appendChild(em);
       }
       h();
     });
   }
   useProfile.onclick=function(){send("",[useProfile,sendTyped]);};
   sendTyped.onclick=function(){send(input.value,[useProfile,sendTyped]);};
   // 引用按钮（发到 session email）只在访客进入时留了 email 时出现；没留 → 只给透传输入框。
   if(d.invited_email){ row.appendChild(useProfile); }
   row.appendChild(input); row.appendChild(sendTyped);
   row.appendChild(skip);
   p.appendChild(row);
   return p;
 }
 function render(d,state){
   document.body.innerHTML="";
   if(!d||!d.ok)return; // book 失败 → 不渲卡（agent 文字解释）
   var root=el("div","card"); root.setAttribute("data-testid","tool-card-calendar_book");
   root.setAttribute("data-cancelled","false");
   var kick=el("div","kicker","booked"); root.appendChild(kick);
   var time=el("div","time",fmt(d.start,d.end)); time.setAttribute("data-testid","book-card-time");
   root.appendChild(time);
   if(d.html_link){
     var link=el("a","link","View on Google Calendar");
     link.setAttribute("href",d.html_link); link.setAttribute("target","_blank");
     link.setAttribute("rel","noopener"); link.setAttribute("data-testid","book-card-link");
     root.appendChild(link);
   }
   // 邀请去向 —— 卡是访客留下的**凭证**（正文会被滚走），所以「有没有人收到邀请」
   // 必须写在卡上，包括"没有"那一种。留空时说清楚这张卡就是唯一记录，否则访客只会
   // 记得聊天里那句"邀请已经发出去了"（F-B-6）。
   var inv=el("div","label muted",
     d.invited_email ? ("calendar invite emailed to "+d.invited_email)
                     : "no invite was emailed — this card is your only record");
   inv.setAttribute("data-testid","book-card-invite");
   root.appendChild(inv);
   var cancel=el("button",null,"Cancel meeting");
   cancel.setAttribute("data-testid","book-card-cancel");
   function toCancelled(){
     root.setAttribute("data-cancelled","true"); kick.textContent="cancelled";
     if(cancel.parentNode)cancel.remove();
     var pr=root.querySelector('[data-testid="booking-email-prompt"]'); if(pr)pr.remove();
     h();
   }
   cancel.onclick=function(){
     cancel.disabled=true;
     callTool("calendar_cancel",{event_id:d.event_id},function(res){
       // 成功取消，或 booking 已不在（幂等：重复取消 / 越权一视同仁）→ 都落 cancelled。
       if(res&&((res.ok&&res.cancelled)||res.error==="booking_not_found")){
         // 先把 cancelled 态落库（mcp-state，按 mcp 隔离），ack 回来再进终态 —— 保证
         // 「显示已取消」时状态已持久，刷新重渲也是 cancelled。
         var rid="s"+(++seq); statePending[rid]=toCancelled;
         parent.postMessage(
           {type:"mcp-ui:state-set",key:d.event_id,value:{cancelled:true},requestId:rid},"*");
       } else { cancel.disabled=false; h(); }
     });
   };
   var crow=el("div","row"); crow.appendChild(cancel); root.appendChild(crow);
   // 确认信 widget 只在 owner 有可用 mail connector（can_email）时进卡：发不了信就别给入口。
   if(d.can_email){ root.appendChild(emailPrompt(d)); }
   // restore：本卡跨刷新状态（host 注入 mcp-ui:data.state）若标了这条 booking 取消 →
   // 直接落 cancelled 终态：没有可点的 cancel、没有发信 prompt，幂等稳定。
   var st=state&&state[d.event_id];
   if(st&&st.cancelled){ toCancelled(); }
   document.body.appendChild(root); h();
 }
 window.addEventListener("message",function(e){
   var m=e.data||{};
   if(m.type==="mcp-ui:data"){ render(m.data||{}, m.state||{}); }
   else if(m.type==="mcp-ui:state-ack"){
     var scb=statePending[m.requestId];
     if(scb){ delete statePending[m.requestId]; scb(); }
   }
   else if(m.type==="mcp-ui:tool-result"){
     var cb=pending[m.requestId];
     if(cb){ delete pending[m.requestId]; cb(m.result||{}); }
   }
 });
 parent.postMessage({type:"mcp-ui:ready"},"*");
})();
</script></body></html>`
