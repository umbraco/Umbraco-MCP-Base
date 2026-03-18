import type { ToolCollectionExport } from "@umbraco-cms/mcp-server-sdk";
import getNotification from "./get-notification.js";
import listNotifications from "./list-notifications.js";
import sendNotification from "./send-notification.js";

const collection: ToolCollectionExport = {
  metadata: {
    name: "notification",
    displayName: "Notifications",
    description: "Notification management tools",
  },
  tools: () => [getNotification, listNotifications, sendNotification],
};

export default collection;
