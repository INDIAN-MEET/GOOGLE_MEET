/**
 * Generates a short, human-shareable room code like "abc-defg-hij".
 * Similar style to Google Meet's meeting links — easy to read and type.
 */

export function generateRoomCode(): string {
    const segment = (len: number): string =>
        Math.random().toString(36).substring(2, 2 + len);
    
    return `${segment(3)}-${segment(4)}-${segment(3)}`;
}