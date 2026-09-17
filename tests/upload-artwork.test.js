const test=require("node:test");
const assert=require("node:assert/strict");
const {createArtworkUploadHandler,decodeArtworkFiles}=require("../api/upload-artwork");
function res(){return{statusCode:200,headers:{},body:null,setHeader(n,v){this.headers[n]=v},end(p){this.body=p?JSON.parse(p):null}}}
async function invoke(handler,body){const r=res();await handler({method:"POST",body},r);return r}
function stripeFactory(session,calls={}){return()=>({checkout:{sessions:{async retrieve(id){calls.retrieved=id;return{...session,id}},async update(id,payload){calls.updated={id,payload};return{id}}}}})}
const env={STRIPE_SECRET_KEY:"sk_test",GMAIL_USER:"3dvr@example.com",GMAIL_APP_PASSWORD:"app",BUSINESS_CARD_ORDER_EMAIL:"esai@example.com,3dvr@example.com"};
const art=[{name:"front.pdf",type:"application/pdf",data:Buffer.from("pdf bytes").toString("base64")}];
const paid={payment_status:"paid",metadata:{checkoutService:"businessCards",orderId:"TEPC-PAID",checkoutOptionLabel:"250 cards",artworkState:"pending"}};

test("paid artwork is emailed and marked received",async()=>{const calls={},sent=[];const handler=createArtworkUploadHandler({env,stripeFactory:stripeFactory(paid,calls),mailTransport:{async sendMail(p){sent.push(p)}}});const r=await invoke(handler,{sessionId:"cs_paid",orderId:"TEPC-PAID",artwork:art});assert.equal(r.statusCode,200);assert.equal(sent.length,1);assert.equal(sent[0].to,"esai@example.com,3dvr@example.com");assert.equal(sent[0].attachments[0].content.toString(),"pdf bytes");assert.match(sent[0].subject,/Paid Third Eye/);assert.equal(calls.updated.payload.metadata.artworkState,"received")});

test("unpaid artwork is never emailed",async()=>{const sent=[];const handler=createArtworkUploadHandler({env,stripeFactory:stripeFactory({...paid,payment_status:"unpaid"}),mailTransport:{async sendMail(p){sent.push(p)}}});const r=await invoke(handler,{sessionId:"cs_unpaid",orderId:"TEPC-PAID",artwork:art});assert.equal(r.statusCode,402);assert.match(r.body.error,/Payment must be completed/i);assert.equal(sent.length,0)});

test("artwork must match the paid order",async()=>{const sent=[];const handler=createArtworkUploadHandler({env,stripeFactory:stripeFactory(paid),mailTransport:{async sendMail(p){sent.push(p)}}});const r=await invoke(handler,{sessionId:"cs_paid",orderId:"TEPC-WRONG",artwork:art});assert.equal(r.statusCode,403);assert.equal(sent.length,0)});

test("already-received artwork is idempotent",async()=>{const sent=[];const handler=createArtworkUploadHandler({env,stripeFactory:stripeFactory({...paid,metadata:{...paid.metadata,artworkState:"received"}}),mailTransport:{async sendMail(p){sent.push(p)}}});const r=await invoke(handler,{sessionId:"cs_paid",orderId:"TEPC-PAID",artwork:art});assert.equal(r.statusCode,200);assert.equal(r.body.alreadyReceived,true);assert.equal(sent.length,0)});

test("artwork validation rejects unsupported types",()=>{assert.throws(()=>decodeArtworkFiles([{name:"bad.svg",type:"image/svg+xml",data:Buffer.from("x").toString("base64")}]),/PDF, JPG, or PNG/)});


test("Stripe lookup errors are not exposed to the browser",async()=>{const handler=createArtworkUploadHandler({env,stripeFactory:()=>({checkout:{sessions:{async retrieve(){const error=new Error("No such checkout.session: secret-ish-detail");error.statusCode=404;throw error}}}}),mailTransport:{async sendMail(){throw new Error("must not send")}}});const r=await invoke(handler,{sessionId:"cs_bad",orderId:"TEPC-BAD",artwork:art});assert.equal(r.statusCode,500);assert.equal(r.body.error,"Could not verify payment or send artwork. Please try again.");assert.doesNotMatch(r.body.error,/checkout\.session/)})
