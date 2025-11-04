import Redis from "ioredis";
import { getRedis } from "./client.js";

let subscriber;

export function getSubscriber() {
    if (subscriber) return subscriber;
    const base = getRedis();
    subscriber = new Redis(base.options);
    subscriber.on("error", (e) => console.error("[redis:sub] error:", e));
    return subscriber;
}

export function publish(channel, message) {
    const data = typeof message === "string" ? message : JSON.stringify(message);
    return getRedis().publish(channel, data);
}

export async function subscribe(channel, handler) {
    const sub = getSubscriber();
    await sub.subscribe(channel);
    sub.on("message", (ch, msg) => {
        if (ch !== channel) return;
        try {
            handler(JSON.parse(msg));
        } catch {
            handler(msg);
        }
    });
}
