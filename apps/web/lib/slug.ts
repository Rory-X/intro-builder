import { customAlphabet } from "nanoid";
const nano = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-", 10);
export const newSlug = () => nano();
