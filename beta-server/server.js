const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();

app.use(express.json());
app.use(express.static('public')); 

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

//  WEBSOCKET
const broadcast = (data) => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
};

// prijimani od alphy
app.post('/webhook-receiver', (req, res) => {
    const { event, data } = req.body;
    console.log(`přijat Webhook: ${event} pro kufr ${data.id}`);

    let wsMessage = {};

    if (event === 'bag_loaded') {
        wsMessage = { 
            type: 'PLANE_LOADED', 
            bag: data 
        };
    } else if (event === 'bag_arrived') {
        const assignedBelt = data.flight.startsWith('OK') ? 1 : 2;
        
        wsMessage = { 
            type: 'BELT_ARRIVAL', 
            bag: data, 
            belt: assignedBelt 
        };
    }
    broadcast(wsMessage);

    res.sendStatus(200); 
});



server.listen(8080, '0.0.0.0', () => {
  console.log('BETA (Display) běží na http://localhost:8080');
});