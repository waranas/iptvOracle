//src/interface/m3uChannel.ts

export interface m3uChannel {
  id: number;
  id_channel: number;
  name: string;
  url: string;
  "tvg-id": string;
  "group-title": string;
  font_ref: number;
  album: string;
  variant_refs: number[];
  active: boolean;
  date_registry: number
}
