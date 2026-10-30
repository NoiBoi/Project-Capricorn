import {z} from 'zod';
const list=z.array(z.string().min(1).max(256)).max(20);
export const CommunicationAccount=z.object({
 id:z.enum(['gmail-0','gmail-1','outlook-0','outlook-1','teams-0','teams-1']),
 clientId:z.string().max(256).default(''),tenant:z.string().regex(/^(?:common|organizations|consumers|[a-fA-F0-9-]{36})$/).default('organizations'),
 labels:list.default(['INBOX']),folders:list.default(['inbox']),senders:list.default([]),excludedSenders:list.default([]),excludedWords:list.default([]),
 selectedMessages:list.default([]),excludedRecords:z.array(z.string().max(100)).max(200).default([]),chats:list.default([]),channels:z.array(z.object({team:z.string().max(100).min(1),channel:z.string().max(256).min(1)}).strict()).max(10).default([]),
}).strict();
export type CommunicationSettings=z.infer<typeof CommunicationAccount>;
export const Stage3Config=z.object({accounts:z.array(CommunicationAccount).max(6),discordChannels:z.array(z.string().regex(/^\d{17,22}$/)).max(10).default([]),voiceGuild:z.string().regex(/^(?:\d{17,22})?$/).default(''),voiceUser:z.string().regex(/^(?:\d{17,22})?$/).default(''),gameProcesses:z.array(z.string().regex(/^[\w .-]+\.exe$/i)).max(20).default([]),discordExcludedAuthors:list.default([]),excludedRecords:z.record(z.string().max(100),z.array(z.string().max(100)).max(200)).default({})}).strict().refine(v=>new Set(v.accounts.map(a=>a.id)).size===v.accounts.length,'Account IDs must be unique');
export type Stage3Settings=z.infer<typeof Stage3Config>;
export const accountIds=['gmail-0','gmail-1','outlook-0','outlook-1','teams-0','teams-1'] as const;
export const stage3Ids=[...accountIds,'discord-local','discord-bot','academic'] as const;
export const defaultStage3=():Stage3Settings=>Stage3Config.parse({accounts:accountIds.map(id=>({id}))});
export const AcademicRecord=z.object({id:z.string().min(1).max(160),course:z.string().min(1).max(100),assignment:z.string().min(1).max(150),status:z.enum(['assigned','due','submitted','graded','feedback','cancelled']),at:z.string().datetime({offset:true}),due:z.string().datetime({offset:true}).optional(),evidence:z.string().min(1).max(800),entities:z.array(z.string().max(100)).max(8).default([])}).strict();
export const AcademicImport=z.array(AcademicRecord).min(1).max(200);
export interface Stage3View {config:Stage3Settings;authorized:Record<string,boolean>;authorization:Record<string,string>;choices:Record<string,{id:string;name:string}[]>;capabilities:Record<string,string>;persistentCredentials:boolean}
