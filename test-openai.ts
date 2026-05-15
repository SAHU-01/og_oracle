import { OpenAI } from "openai";
console.log("OpenAI class:", OpenAI);
const client = new OpenAI({ apiKey: "test" });
console.log("Client created");
