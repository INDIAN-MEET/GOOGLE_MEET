import axios from 'axios';
import { ROOM_SERVICE_URL } from './env.js';

/**  
 * @description Get active room by code
 * @returns {Promise<Room>}
 * @throws {Error}
 */
export async function getActiveRoom(code: string, token: string) {
    const resp = await axios.get(`${ROOM_SERVICE_URL}/v1/rooms/${code}`, {
        headers: { Authorization: `Bearer ${token}` }
    })

    return resp.data.data.room
}