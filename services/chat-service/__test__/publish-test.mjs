// Run: node publish-test.mjs
import { createClient } from 'redis';

const client = createClient({ url: 'redis://localhost:6379' });

await client.connect();

const payload = JSON.stringify({
    roomId: 'fbu-bkv0-dog',
    senderId: 'user-001',
    senderName: 'Alice',
    text: 'Hello from Node publisher!'
});

console.log('Publishing:', payload);
const result = await client.publish('chat-message', payload);
console.log(`Delivered to ${result} subscriber(s)`);

await client.disconnect();
