"use client";
import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

let singleton: Socket | null = null;
export function getSocket(): Socket {
  if (!singleton) {
    singleton = io({ path: "/api/socketio", transports: ["websocket", "polling"] });
  }
  return singleton;
}

export function useSocket() {
  const [sock, setSock] = useState<Socket | null>(null);
  useEffect(() => {
    const s = getSocket();
    setSock(s);
    return () => undefined;
  }, []);
  return sock;
}