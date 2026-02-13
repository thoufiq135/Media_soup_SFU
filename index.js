const express=require("express")
const mediasoup=require("mediasoup")
const cors=require("cors")
const {Server}=require("socket.io")
const http=require("http")
const { default: socket } = require("../virtual_campus_glang/frontend/virtual_campus/src/socket")

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
io.on("connection",socket=>{
    console.log("user connected = ",socket.id)
    peers.set(socket.id,{
        roomid:null,
        name:null,
        avatar:null,
        
        sendTransport:null,
    recvTransport:null,
        producers:[],
        consumers:[]
    })

    socket.on("joinRoom",({roomid,name,avatar_url},cb)=>{
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
            listenIps: [{ ip:"0.0.0.0", announcedIp: "ws.gsin.online" }],
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
        listenIps:[{ip:"0.0.0.0", announcedIp: "ws.gsin.online"}],
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
socket.on("connectRecvTransport",async({dtlsParameters},cb)=>{
    console.log("came to connectRecvTransport")
    
    const peer=peers.get(socket.id)
    console.log("peer=",peer)
    await peer.recvTransport.connect({dtlsParameters})
    if (peer.consumers) {
    for (const consumer of peer.consumers) {
      if (consumer.paused) {
        await consumer.resume()
        console.log("consumer resumed:", consumer.id)
      }
    }
  }
    cb && cb()
     console.log("completed connectRecvTransport")
})
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
   rtpParameters:consumer.rtpParameters
 })

})
})


server.listen(3030,"0.0.0.0",()=>{
    console.log("server is running on port 3030")
});
