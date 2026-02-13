const express=require("express")
const mediasoup=require("mediasoup")
const cors=require("cors")
const {Server}=require("socket.io")
const http=require("http")


const app=express()
app.use(cors())

app.use(express.json())
const server= http.createServer(app)
const consumers = new Map();

const io=new Server(server,{
path: "/socket.io",
    cors:{
        origin:"https://gsin.online",
        methods:["GET","POST"],
        credentials:true
    },
    transports:["polling","websocket"],
 allowEIO3: true
})
let worker;
const peers=new Map()
const mediaCodecs=[
    {kind:"audio",mimeType:"audio/opus",clockRate:48000,channels:2},
    {kind:"video",mimeType:"video/VP8",clockRate:90000}
]

const rooms={
    room1:{router:null,producers:[], users:[], max:25},
    room0:{ router:null,producers:[], users:[],max:4},
    room2:{ router:null,producers:[], users:[],max:4},
    room3:{ router:null,producers:[], users:[],max:4},
    room4:{ router:null,producers:[], users:[],max:4},
    room5:{ router:null,producers:[], users:[],max:4},
    room6:{ router:null,producers:[], users:[],max:4},
    room7:{ router:null,producers:[], users:[],max:4},
    room8:{ router:null,producers:[], users:[],max:4},
}
async function startMediaSoup(){
    worker=await mediasoup.createWorker()
    console.log("worker created")
    for(const roomid in rooms){
    rooms[roomid].router=await worker.createRouter({mediaCodecs})
    console.log(`room id created for roomid ${roomid} : ${rooms[roomid].router.id}`)

}
}
startMediaSoup()
function cleanupPeer(socketId) {

  const peer = peers.get(socketId);
  if (!peer) return;

  console.log("cleaning peer:", socketId);

  // close producers
  peer.producers?.forEach(p => p.close());

  // close consumers
  peer.consumers?.forEach(c => c.close());

  // close transports
  peer.sendTransport?.close();
  peer.recvTransport?.close();

  // remove from room
  const room = rooms[peer.roomid];
  if (room) {

    room.users = room.users.filter(id => id !== socketId);

    room.producers = room.producers.filter(pid =>
      !peer.producers?.find(p => p.id === pid)
    );
  }

 peer.roomid = null;
peer.sendTransport = null;
peer.recvTransport = null;
peer.producers = [];
peer.consumers = [];

  console.log("peer removed completely");
}

io.on("connection",socket=>{
    console.log("user connected = ",socket.id)
    peers.set(socket.id,{
      socketId: socket.id,
        roomid:null,
        name:null,
        avatar:null,
        
        sendTransport:null,
    recvTransport:null,
        producers:[],
        consumers:[]
    })

    socket.on("joinRoom",({roomid,name,avatar_url},cb)=>{
      if(!roomid||!avatar_url){
        console.log("error roomid or avatar url")
        return
      }
      if (!peers.has(socket.id)) {
    peers.set(socket.id, {
      socketId: socket.id,
      roomid: null,
      name: null,
      avatar: null,
      sendTransport: null,
      recvTransport: null,
      producers: [],
      consumers: []
    });
  }
const room=rooms[roomid];
if(!room) return cb({error:"Room not found"})
 if (room.users.length >= room.max)
    return cb({ error:"Room is full" });
socket.join(roomid);
const peer=peers.get(socket.id)
 peer.roomid=roomid
 const Name=name.display_name
peer.name=Name
peer.avatar=avatar_url
room.users.push(socket.id);

  console.log(`${socket.id} joined ${roomid} avatar = ${avatar_url} name= ${Name}`);
  room.producers.forEach(producerId => {
  socket.emit("newProducer", { producerId });
});

cb({
rtpCapabilities:room.router.rtpCapabilities,
producer:room.producers
})

    })
    socket.on("createTransport",async(data,cb)=>{
        console.log("came to createTransport")
        const peer = peers.get(socket.id)
        const room=rooms[peer.roomid]
        if(!peer||!room){
            console.log("peer or room not found")
            return cd({error:"peer or name not found"})
        }
        const transport=await room.router.createWebRtcTransport({
            listenIps: [{ ip:"0.0.0.0", announcedIp: "127.0.0.1" }],
        enableUdp:true,
        enableTcp:true,
        preferUdp:true
        })
         peer.sendTransport = transport
         const users = room.users.map(id => {
    const p = peers.get(id)
    return {
        id,
        name: p.name,
        avatar: p.avatar
    }
})
         cb({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        users
    })
    console.log("completed createTransport")
    })
    socket.on("connectTransport",async({dtlsParameters},cb)=>{
        console.log("came to connectTransport")
        const peer=peers.get(socket.id)
        
        if (peer.sendTransport.appData?.connected) {
  return cb && cb();
}
        await peer.sendTransport.connect({dtlsParameters})
        peer.sendTransport.appData = { connected: true };
        cb && cb()
          console.log("completed connectTransport")
    }    )
    socket.on("produce",async({kind,rtpParameters},cb)=>{
      console.log("came to produce")
    const peer=peers.get(socket.id)
    const room = rooms[peer.roomid]
    const producer=await peer.sendTransport.produce({kind,rtpParameters})
    await producer.resume()
    room.producers.push(producer.id)
     cb({ id: producer.id })
     io.to(peer.roomid).emit("newProducer",{
        producerId:producer.id
     })
     console.log("PRODUCER CREATED:", producer.id)
console.log("producer paused?", producer.paused)

producer.on("transportclose",()=>console.log("producer transport closed"))
producer.on("close",()=>console.log("producer closed"))

     console.log("completed produce")
})
socket.on("createRecvTransport",async(data,cb)=>{
    console.log("came to creatRecvTransport")
    if(typeof cb !== "function"){
   console.log("missing callback")
   return
 }
    const peer=peers.get(socket.id)
    const room=rooms[peer.roomid]
    const transport=await room.router.createWebRtcTransport({
        listenIps:[{ip:"0.0.0.0", announcedIp: "127.0.0.1"}],
     enableUdp:true,
     enableTcp:true,
     preferUdp:true
    })
    peer.recvTransport=transport
    cb({
   id:transport.id,
   iceParameters:transport.iceParameters,
   iceCandidates:transport.iceCandidates,
   dtlsParameters:transport.dtlsParameters
 })
 console.log("completed creatRecvTransport",transport)
})
socket.on("connectRecvTransport", async ({ dtlsParameters }, cb) => {

  console.log("came to connectRecvTransport");

  const peer = peers.get(socket.id);

  if (!peer || !peer.recvTransport) {
    console.log("recvTransport missing");
    return cb && cb({ error: "recvTransport not found" });
  }

  // 🔥 IMPORTANT GUARD
  if (peer.recvTransport.appData?.connected) {
    console.log("recvTransport already connected");
    return cb && cb();
  }

  await peer.recvTransport.connect({ dtlsParameters });

  // ⭐⭐⭐ THIS LINE WAS MISSING
  peer.recvTransport.appData = { connected: true };

  // optional (not required but fine)
  if (peer.consumers) {
    for (const consumer of peer.consumers) {
      if (consumer.paused) {
        await consumer.resume();
        console.log("consumer resumed:", consumer.id);
      }
    }
  }

  cb && cb();

  console.log("completed connectRecvTransport");
});

socket.on("consume",async({producerId, rtpCapabilities},cb)=>{
   console.log("CONSUME REQUEST for producer", producerId)
   
     const peer = peers.get(socket.id)
   

 const room = rooms[peer.roomid]
if(!room.router.canConsume({
    producerId,
    rtpCapabilities
 })) return cb({error:"cannot consume"})
 const consumer =
   await peer.recvTransport.consume({
     producerId,
     rtpCapabilities,
     paused: true

   })
     if (!peer.consumers) peer.consumers = []
await consumer.resume();
peer.consumers.push(consumer)
  console.log("consumer created:", consumer.id)
console.log("consumer paused?", consumer.paused)
 consumer.on("transportclose",()=>console.log("consumer transport closed"))
consumer.on("producerclose",()=>console.log("producer closed for this consumer"))
 cb({
   id:consumer.id,
   kind:consumer.kind,
   rtpParameters:consumer.rtpParameters,
    peerId: peer.socketId 
 })

})
socket.on("leaveRoom", () => {
  console.log("leaveRoom:", socket.id);
  cleanupPeer(socket.id);
});
// socket.on("disconnect", () => {
//   console.log("disconnected:", socket.id);
//   cleanupPeer(socket.id);
// });

})


server.listen(3030,"0.0.0.0",()=>{
    console.log("server is running on port 3030")
});
