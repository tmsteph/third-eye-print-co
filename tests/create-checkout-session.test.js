const test = require("node:test");
const assert = require("node:assert/strict");
const { createCheckoutSessionHandler } = require("../api/create-checkout-session");

function createMockRes(){return{statusCode:200,headers:{},body:null,setHeader(name,value){this.headers[name]=value},end(payload){this.body=payload?JSON.parse(payload):null}}}
function createStripeFactory(calls){return secretKey=>{calls.secretKey=secretKey;return{checkout:{sessions:{async create(payload){calls.payload=payload;return{id:"cs_test_123",url:"https://checkout.stripe.test/session"}}}}}}}
const baseEnv={STRIPE_SECRET_KEY:"sk_test_secret",SITE_URL:"https://third-eye.example",STRIPE_CURRENCY:"usd"};
async function invoke(handler,body){const res=createMockRes();await handler({method:"POST",headers:{},body},res);return res}

test("business card checkout starts without artwork delivery",async()=>{const calls={};const handler=createCheckoutSessionHandler({env:baseEnv,stripeFactory:createStripeFactory(calls)});const res=await invoke(handler,{lead:{name:"Jane Doe",email:"jane@example.com",serviceType:"Business cards",checkoutOptionId:"cards-100",quantity:"100 cards"}});assert.equal(res.statusCode,200);assert.equal(calls.payload.line_items[0].price_data.unit_amount,2900);assert.equal(calls.payload.metadata.checkoutService,"businessCards");assert.equal(calls.payload.metadata.artworkState,"pending");assert.equal(calls.payload.phone_number_collection.enabled,false);assert.match(calls.payload.success_url,/\/business-cards\/\?payment=success&order=TEPC-[^&]+&session_id=\{CHECKOUT_SESSION_ID\}/);assert.doesNotMatch(calls.payload.success_url,/artwork=/);assert.equal(res.body.artworkState,undefined)});

test("checkout API refuses pre-payment artwork bytes",async()=>{const calls={};const handler=createCheckoutSessionHandler({env:baseEnv,stripeFactory:createStripeFactory(calls)});const res=await invoke(handler,{lead:{serviceType:"Business cards",checkoutOptionId:"cards-50"},artwork:[{name:"front.png",type:"image/png",data:Buffer.from("png").toString("base64")}]});assert.equal(res.statusCode,400);assert.match(res.body.error,/after payment/i);assert.equal(calls.payload,undefined)});

test("create-checkout-session still supports event tent checkout",async()=>{const calls={};const handler=createCheckoutSessionHandler({env:baseEnv,stripeFactory:createStripeFactory(calls)});const res=await invoke(handler,{lead:{serviceType:"Event tent",checkoutOptionId:"tent-3",quantity:"3 tents"}});assert.equal(res.statusCode,200);assert.equal(calls.payload.line_items[0].price_data.unit_amount,270000);assert.equal(calls.payload.metadata.checkoutService,"eventTent")});

test("create-checkout-session still supports bundle checkout",async()=>{const calls={};const handler=createCheckoutSessionHandler({env:baseEnv,stripeFactory:createStripeFactory(calls)});const res=await invoke(handler,{lead:{serviceType:"Tent and card bundles",checkoutOptionId:"bundle-5-500"}});assert.equal(res.statusCode,200);assert.equal(calls.payload.line_items[0].price_data.unit_amount,430000);assert.equal(calls.payload.metadata.checkoutService,"bundleDeal")});

test("create-checkout-session rejects unsupported services",async()=>{const handler=createCheckoutSessionHandler({env:baseEnv,stripeFactory:createStripeFactory({})});const res=await invoke(handler,{lead:{serviceType:"Embroidery"}});assert.equal(res.statusCode,400)});
