import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.myinvestmentjournal.app",
  appName: "My Investment Journal",
  webDir: "dist",
  server: {
    url: "https://my-investment-journal.vercel.app",
    cleartext: false
  },
  android: {
    backgroundColor: "#f8fafc"
  }
};

export default config;
