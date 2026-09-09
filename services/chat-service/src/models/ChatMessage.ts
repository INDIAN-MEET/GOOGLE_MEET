import mongoose, { Schema, Document } from 'mongoose';

export interface IChatMessage extends Document {
    roomId: string;
    senderId: string;
    senderName: string;
    text: string;
    createdAt: Date;
}

const chatMessageSchema = new Schema<IChatMessage>({
    roomId: { type: String, required: true, index: true },
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    text: { type: String, required: true, maxlength: 2000 },
    createdAt: { type: Date, default: Date.now },
});

// Compound index: history reads are always "give me messages for this room,
// oldest to newest" — this index makes that query fast even at high volume.
chatMessageSchema.index({ roomId: 1, createdAt: 1 });

export const ChatMessage = mongoose.model<IChatMessage>('ChatMessage', chatMessageSchema);