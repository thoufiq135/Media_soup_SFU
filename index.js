const express=require("express")
const mediasoup=require("mediasoup")
const cors=require("cors")
const {Server}=require("socket.io")
const http=require("http")
const { error } = require("console")
const app=express()
app.use(cors())

app.use(express.json())
const server= http.createServer(app)
const io=new Server(server,{
    cors:{
        origin:"https://gsin.online",
        methods:["GET","POST"],
        credentials:true
    },
    transports:["websocket","polling"]
})
let workers;
const mediaCodecs=[
    {kind:"audio",mimeType:"audio/opus",clockRate:48000,channels:2},
    {kind:"video",mimeType:"video/VP8",clockRate:90000}
]

const rooms={
    room1:{router:null, users:[], max:25},
    room0:{ router:null, users:[],max:4},
    room2:{ router:null, users:[],max:4},
    room3:{ router:null, users:[],max:4},
    room4:{ router:null, users:[],max:4},
    room5:{ router:null, users:[],max:4},
    room6:{ router:null, users:[],max:4},
    room7:{ router:null, users:[],max:4},
    room8:{ router:null, users:[],max:4},
}
async function startMediaSoup(){
    workers=await mediasoup.createWorker()
    console.log("worker created")
    for(const roomid in rooms){
    rooms[roomid].router=await workers.createRouter({mediaCodecs})
    console.log(`room id created for roomid ${roomid} : ${rooms[roomid].router.id}`)

}
}
startMediaSoup()
io.on("connection",socket=>{
    console.log("user connected = ",socket.id)
    socket.on("joinRoom",({roomid},cb)=>{
        console.log("room id came=",roomid)
        const room=rooms[roomid]
        if(!room) return cb({error:"Room not found"})
        if(room.users.length>=room.max){
            return cb({error:"Room is full"})
        }
        socket.join(roomid)
        room.users.push(socket.id)
        socket.roomid=roomid
        console.log(`${socket.id} joined room ${roomid}`)
        cb({rtpCapabilities:room.router.rtpCapabilities})
    })
    socket.on("createTransport",async(cb)=>{
        const roomid=socket.roomid
        const router=rooms[roomid].router
        const transport=await router.createWebRtcTransport({
            listenIps:[{ip:"0.0.0.0",announcedIp:null}],
            enableUdp:true,
            enableTcp:true,
            preferUdp:true
        })
        socket.sendTransport=transport
        cb({
            id:transport.id,
             iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters
        })
    })
    socket.on("connectTransport",async({dtlsParameters})=>{
        console.log(dtlsParameters)
        await socket.sendTransport.connect({dtlsParameters})
        console.log("transport created")
    })
    socket.on("produce",async ({kind,rtpParameters},cb)=>{
        const producer = await socket.sendTransport.produce({kind,rtpParameters})
        socket.producer=producer
        console.log("producer created:",producer.id)
        socket.to(socket.roomid).emit("newProducer",{
            producerId:producer.id
        })
        cb({id:producer.id})
    })
    socket.on("createRecvTransport", async (cb) => {

  const router = rooms[socket.roomid].router;

  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: "0.0.0.0", announcedIp: null }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true
  });

  socket.recvTransport = transport;

  cb({
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters
  });
});
socket.on("connectRecvTransport", async ({ dtlsParameters }) => {
  await socket.recvTransport.connect({ dtlsParameters });
});
socket.on("consume", async ({ producerId, rtpCapabilities }, cb) => {

  const router = rooms[socket.roomid].router;

  if (!router.canConsume({
    producerId,
    rtpCapabilities
  })) return;

  const consumer = await socket.recvTransport.consume({
    producerId,
    rtpCapabilities,
    paused: true
  });
socket.consumer=consumer
  cb({
    id: consumer.id,
    producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters
  });
});
socket.on("resumeConsumer", async () => {
  await socket.consumer.resume();
});
    socket.on("leaveRoom", () => {

  const roomid = socket.roomid;
  if (!roomid) return;

  if (socket.consumer) socket.consumer.close();

  if (socket.producer) {
    socket.producer.close();

    socket.to(roomid).emit("producerClosed", {
      producerId: socket.producer.id
    });
  }

  if (socket.sendTransport) socket.sendTransport.close();
  if (socket.recvTransport) socket.recvTransport.close();

  rooms[roomid].users =
    rooms[roomid].users.filter(id => id !== socket.id);

  socket.leave(roomid);
});

    socket.on("disconnect",()=>{
        const roomid=socket.roomid
        if(!roomid) return console.log("no room found");
        rooms[roomid].users=rooms[roomid].users.filter(id=>id!==socket.id)
        console.log(`${socket.id} left ${roomid}`)
    })
})
server.listen(3030,"0.0.0.0",()=>{
    console.log("server is running on port 3030")
});