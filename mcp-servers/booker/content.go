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
const instructions = `This is the owner's calendar. **Your tools decide what you can offer** — read the tool list you were given and offer only what is on it. Some of these tools are only present when the owner's calendar grant allows that action, so a tool that is absent is not one to promise, apologise for, or ask the visitor to wait for; simply do not raise it. Never tell the visitor you will do something you have no tool for.

1. **calendar_list_slots** — search a time window and get back the free [start, end] slots that pass the owner's booking policy. Pass ` + "`from_rfc3339`" + `, ` + "`until_rfc3339`" + `, and ` + "`duration_min`" + `. Use this *before* offering times so you propose ones the owner actually has free.

Default flow when you can act on a time: ask topic + duration **and roughly when the visitor wants to meet** (a day or a window — don't guess it for them). Search a window around what they asked for, present 2-3 of the available slots in their local time, and wait for them to pick. Each tool's own description says what it needs and when to call it.

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
 /* The read-only chip: not a disabled button, a slot of time. A greyed-out button says "wait a
    moment", and here nothing is coming. */
 .chip.readonly{border-color:#d9d0c2;color:#6b5d4f;cursor:default}
 .chip.readonly:hover{background:#F3EFE6;color:#6b5d4f}
 .empty{margin-top:8px;color:#6b5d4f;font-size:12px}
</style></head><body>
<script>
(function(){
 var byDay={}, order=[], sel="", canBook=true;
 function h(){parent.postMessage({type:"mcp-ui:height",
   height:document.documentElement.scrollHeight+8},"*");}
 function fmtDay(d){return d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});}
 function fmtTime(d){return d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});}
 // slotZone —— which zone these chips are in (the zone of the browser rendering this
 // widget). Stated once, in the header.
 function slotZone(){
   try{
     var parts=new Intl.DateTimeFormat([],{timeZoneName:"short"}).formatToParts(new Date());
     for(var i=0;i<parts.length;i++){if(parts[i].type==="timeZoneName")return parts[i].value;}
   }catch(_){}
   return "your time";
 }
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
 // renderTimes —— when canBook=false the chip is not a button, it's a read-only slot of
 // time (F-B-10). An instance granted only calendar.readonly can read free/busy but can't
 // write events: then every clickable chip would be an entry point to an action that can't
 // happen, and a visitor tapping it would just get "booking that now" and nothing would
 // follow. Don't offer an entry point you can't deliver — the same rule the booked card
 // follows with can_email deciding whether to render the confirmation-email widget.
 function renderTimes(host){
   host.innerHTML="";
   var day=byDay[sel]; if(!day)return;
   day.items.forEach(function(it){
     var label=fmtTime(it.start)+" – "+fmtTime(it.end);
     if(!canBook){
       var s=el("span","chip readonly",label);
       s.setAttribute("data-testid","tool-card-slot-readonly");
       host.appendChild(s);
       return;
     }
     var b=el("button","chip",label);
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
   // The timezone is **stated once, in the header** (a neighbor of UX-69): every chip in
   // this widget is in the same zone, printing it on each one would turn this row of
   // numbers into noise — and picking a slot is a task where the eye has to compare numbers.
   var kick=el("span","kicker",(canBook?"available · ":"owner's free time · ")
     +slots.length+" slots · times in "+slotZone());
   kick.setAttribute("data-testid","bookings-kicker");
   sum.appendChild(kick); det.appendChild(sum);
   if(slots.length===0){
     det.appendChild(el("div","empty","no free slots in that window — try a different range."));
   } else {
     // State plainly what this widget is right now. A clickable entry point missing with
     // no explanation reads as broken.
     if(!canBook){
       var note=el("div","empty","this is when the owner is free — booking isn't switched on here.");
       note.setAttribute("data-testid","slots-readonly-note");
       det.appendChild(note);
     }
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
     var d=e.data.data||{};
     // A missing field defaults to **cannot book**. Offering an entry point that leads to
     // nothing is worse than offering one fewer.
     canBook = d.can_book === true;
     render(Array.isArray(d.slots)?d.slots:[]); h();
   }
 });
 parent.postMessage({type:"mcp-ui:ready"},"*");
})();
</script></body></html>`

// bookedCardHTML —— the "booking confirmed" card (sandboxed iframe) shown after
// calendar_book succeeds. Receives the book result {ok,event_id,html_link,start,end} via
// mcp-ui:data and renders: time + GCal link + cancel button + a "send confirmation email?"
// widget. Cancel / send dispatch via mcp-ui:tool to the host (calendar_cancel /
// send_confirmation); the host runs the connector-backed op and posts mcp-ui:tool-result
// back, and the card flips to cancelled / sent on that. Credentials stay in the host the
// whole time; the card is offline and only ever sends protocol messages.
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
 /* A group of actions has only one lead (UX-92). This widget used to have four actions
    **fully equal-weight**: two "send", one "don't send", one "cancel the meeting", same
    box, same font size — a visitor had to read them all to figure out which to press.
    The primary action is solid, the exit path demotes to a text link — consistent with
    the rest of the product (gate's ENTER, the modal's CREATE CODE). */
 button.primary{background:#1B1814;color:#F3EFE6}
 button.primary:hover:not(:disabled){background:#000}
 button.quiet{border:0;background:none;padding:5px 2px;color:#6b5d4f;text-decoration:underline}
 button.quiet:hover:not(:disabled){background:none;color:#1B1814}
 /* The action that undoes this card should not carry the same visual weight as an ordinary
    confirm (UX-69). Cancel meeting used to be an outlined button — identical to the Send
    button below it, even though the two consequences differ by an order of magnitude: one
    sends an email, the other gives back a slot of time that was already held. Every
    destructive/undo action elsewhere in the product looks like this (the corpus row's
    DELETE, the connector card's DISCONNECT): don't compete on weight, use vermillion to
    mark it as that class of action.
    Note: this comment lives inside a Go raw-string backtick literal — no backticks allowed
    in it, and avoid characters like × too. */
 button.danger{border:0;background:none;padding:5px 2px;color:#B5391C;text-decoration:underline}
 button.danger:hover:not(:disabled){background:none;color:#1B1814}
 .prompt{margin-top:10px;border-top:1px solid #d9d0c2;padding-top:8px}
 .label{font:12px ui-serif,Georgia,serif;margin-bottom:6px}
 input{padding:5px 7px;border:1px solid #1B1814;background:#fff;font:12px ui-monospace,monospace;flex:1;min-width:120px}
 .err{margin-top:6px;color:#B5391C;font-size:12px}
 .muted{color:#6b5d4f}
 /* "In progress" has to look **alive** (UX-92). It used to be one line of small grey text
    plus the button greying out at the same time — two weak signals stacked together, which
    reads as broken rather than busy, and this step can take upwards of ten seconds. */
 .busy{color:#6b5d4f;font:12px ui-serif,Georgia,serif;margin-top:6px}
 .busy .dot{animation:sm-blink 1.1s infinite}
 .busy .dot:nth-child(2){animation-delay:.15s}
 .busy .dot:nth-child(3){animation-delay:.3s}
 @keyframes sm-blink{0%,80%,100%{opacity:.25}40%{opacity:1}}
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
   // The timezone follows the time (UX-69). This card is the **record** the visitor keeps —
   // the two timezones mentioned in the chat body will scroll away, the card stays; a bare
   // "8:00 AM" is meaningless to someone not in that zone.
   // Printed once at the end: both ends are the same zone, printing it twice is noise.
   return d+" · "+t(a)+"–"+t(b)+" "+zoneOf(b);
 }
 // zoneOf —— the timezone abbreviation of where this widget is actually rendering
 // (EDT / GMT+8 …). The card renders in the **visitor's** browser, so this reports the
 // visitor's own zone — exactly the one they need to confirm.
 function zoneOf(x){
   try{
     var parts=new Intl.DateTimeFormat([],{timeZoneName:"short"}).formatToParts(x);
     for(var i=0;i<parts.length;i++){if(parts[i].type==="timeZoneName")return parts[i].value;}
   }catch(_){}
   return "";
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
   // The primary action is "send to my email" — the visitor already gave an email when
   // registering, so that's the one they're most likely to press.
   var useProfile=el("button","primary","Use my email");
   useProfile.setAttribute("data-testid","booking-email-use-profile");
   var input=el("input"); input.setAttribute("data-testid","booking-email-other");
   input.placeholder="a different address";
   var sendTyped=el("button",null,"Send");
   sendTyped.setAttribute("data-testid","booking-email-send");
   var skip=el("button","quiet","No thanks");
   skip.setAttribute("data-testid","booking-email-skip");
   skip.onclick=function(){
     p.setAttribute("data-sent","true");
     p.innerHTML=""; p.appendChild(el("div","label muted","no confirmation sent"));
     h();
   };
   function send(recipient,btns){
     btns.forEach(function(b){b.disabled=true;});
     // In-progress must **say so**. This step spins up a sandbox on the backend, ~1s
     // when idle, seen up to 19s when the machine is loaded — and before this line, all
     // the visitor saw was the button turning grey, with nothing moving for ten-plus
     // seconds. They'd think the click didn't register and click again (an idempotency
     // marker blocks the duplicate send, but what they see is still a dead button).
     var busy=el("div","busy","sending");
     busy.setAttribute("data-testid","booking-email-sending");
     ["·","·","·"].forEach(function(c){busy.appendChild(el("span","dot",c));});
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
   // The profile-email button (send to the session email) only appears when the visitor
   // left an email on entry; if not, they only get the pass-through input.
   //
   // **The lead changes accordingly** (UX-92): when an email was left, "use my email" is
   // the most likely button, so it goes solid; when no email was left, that button doesn't
   // render at all — and if primary still hung off it, the whole row would have zero solid
   // buttons, back to "four equal-weight actions". So whoever is present becomes the lead.
   if(d.invited_email){ row.appendChild(useProfile); } else { sendTyped.className="primary"; }
   row.appendChild(input); row.appendChild(sendTyped);
   row.appendChild(skip);
   p.appendChild(row);
   return p;
 }
 function render(d,state){
   document.body.innerHTML="";
   if(!d||!d.ok)return; // book failed → don't render a card (the agent explains in text)
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
   // Invite destination — the card is the **record** the visitor keeps (the chat body
   // scrolls away), so "did anyone get invited" must be stated on the card, including the
   // "no" case. When it's blank, say plainly that this card is the only record, otherwise
   // the visitor will only remember the chat's "an invite has been sent" line (F-B-6).
   var inv=el("div","label muted",
     d.invited_email ? ("calendar invite emailed to "+d.invited_email)
                     : "no invite was emailed — this card is your only record");
   inv.setAttribute("data-testid","book-card-invite");
   root.appendChild(inv);
   var cancel=el("button","danger","Cancel meeting");
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
       // Cancel succeeded, or the booking is already gone (idempotent: a repeat cancel /
       // an unauthorized attempt are treated the same) → both land on cancelled.
       if(res&&((res.ok&&res.cancelled)||res.error==="booking_not_found")){
         // Persist the cancelled state first (mcp-state, isolated per mcp), then move to
         // the terminal state once the ack comes back — this guarantees that by the time
         // "cancelled" is shown, the state is already durable, so a refresh re-renders
         // cancelled too.
         var rid="s"+(++seq); statePending[rid]=toCancelled;
         parent.postMessage(
           {type:"mcp-ui:state-set",key:d.event_id,value:{cancelled:true},requestId:rid},"*");
       } else { cancel.disabled=false; h(); }
     });
   };
   var crow=el("div","row"); crow.appendChild(cancel); root.appendChild(crow);
   // The confirmation-email widget only enters the card when the owner has a usable mail
   // connector (can_email): don't offer the entry point if it can't send.
   if(d.can_email){ root.appendChild(emailPrompt(d)); }
   // restore: cross-refresh state for this card (the host injects mcp-ui:data.state) — if
   // this booking is flagged cancelled, land directly on the cancelled terminal state: no
   // clickable cancel, no send prompt, idempotently stable.
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
