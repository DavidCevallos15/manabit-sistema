import type { Profile, agentRoles } from "../server/profile";
import type { Conversation, Task } from "../server/conversations";
import type { Booking, Channel } from "../core/types";
import type { Job } from "../server/channels";
export interface Draft {
  id: string;
  kind: string;
  text: string;
  engine: string;
  at: string;
}
export interface ChannelState {
  id: Channel;
  status: string;
  missing: string[];
  lastEventAt?: string;
  automaticReplies: boolean;
}
export interface AdminState {
  profile: Profile;
  conversations: Conversation[];
  bookings: Booking[];
  tasks: Task[];
  drafts: Draft[];
  jobs: Job[];
  metrics: {
    conversations: number;
    waiting: number;
    confirmed: number;
    cancelled: number;
    tasks: number;
    simulated: number;
  };
  contacts: { id: string; name: string; detail: string }[];
  channels: ChannelState[];
  agents: typeof agentRoles;
  google: boolean;
  ownerGoogle: boolean;
  local: boolean;
}
