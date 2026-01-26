/**
 * Umbraco Authorization Policies
 *
 * This file demonstrates how to implement user-based authorization policies
 * for filtering which tools are available to different users based on their
 * Umbraco permissions.
 *
 * HOW IT WORKS:
 * =============
 * Umbraco users have:
 * - User Groups (e.g., Administrators, Editors, Writers)
 * - Allowed Sections (e.g., Content, Media, Settings)
 *
 * These policies check the current user's permissions and return true/false
 * to determine if they should have access to specific tools.
 *
 * USAGE:
 * ======
 * In your tool collection, you can filter tools based on user permissions:
 *
 * ```typescript
 * import { AuthorizationPolicies } from "../helpers/auth/umbraco-auth-policies.js";
 *
 * export function tools(context: { user?: CurrentUserResponseModel }) {
 *   const allTools = [createDocumentTool, editMediaTool, manageUsersTool];
 *
 *   // Filter tools based on user permissions
 *   return allTools.filter(tool => {
 *     if (tool.name === "manage-users") {
 *       return context.user && AuthorizationPolicies.SectionAccessUsers(context.user);
 *     }
 *     return true;
 *   });
 * }
 * ```
 *
 * CUSTOMIZATION:
 * ==============
 * - Add new policies for your specific authorization needs
 * - Combine multiple section checks for complex permissions
 * - Use RequireAdminAccess for admin-only operations
 *
 * REFERENCE:
 * ==========
 * Section aliases match Umbraco's internal section identifiers.
 * The AdminGroupKeyString matches the hardcoded value in Umbraco source code.
 */

/**
 * User response model from Umbraco Management API.
 * Replace this with your Orval-generated type if available.
 */
export interface UserContext {
  userGroupIds: Array<{ id: string }>;
  allowedSections: string[];
}

/**
 * Hardcoded Admin Group ID from Umbraco source code.
 * This is the GUID for the built-in Administrators group.
 */
export const AdminGroupKeyString = "E5E7F6C8-7F9C-4B5B-8D5D-9E1E5A4F7E4D";

/**
 * Umbraco backoffice section aliases.
 * These match the section identifiers used in Umbraco's backoffice.
 */
export const sections = {
  content: "Umb.Section.Content",
  forms: "Umb.Section.Forms",
  media: "Umb.Section.Media",
  members: "Umb.Section.Members",
  packages: "Umb.Section.Packages",
  settings: "Umb.Section.Settings",
  translation: "Umb.Section.Translation",
  users: "Umb.Section.Users",
};

/**
 * Authorization policies for checking user permissions.
 *
 * Each policy is a function that takes a user context and returns
 * true if the user has the required permissions.
 *
 * Policies are named to match Umbraco's internal authorization policy names
 * where applicable, making it easier to maintain consistency.
 */
export const AuthorizationPolicies = {
  /**
   * Check if user is in the Administrators group.
   * Use for operations that require full admin access.
   */
  RequireAdminAccess: (user: UserContext) =>
    user.userGroupIds.some(
      (groupId) => groupId.id.toUpperCase() === AdminGroupKeyString
    ),

  // ---------------------------------------------------------------------------
  // Section Access Policies
  // ---------------------------------------------------------------------------

  /** User has access to the Content section */
  SectionAccessContent: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.content),

  /** User has access to Content or Media sections */
  SectionAccessContentOrMedia: (user: UserContext) =>
    user.allowedSections.some(
      (section) => section === sections.content || section === sections.media
    ),

  /** User has access to Media section */
  SectionAccessMedia: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.media),

  /** User has access to Members section */
  SectionAccessMembers: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.members),

  /** User has access to Packages section */
  SectionAccessPackages: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.packages),

  /** User has access to Settings section */
  SectionAccessSettings: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.settings),

  /** User has access to Users section */
  SectionAccessUsers: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.users),

  // ---------------------------------------------------------------------------
  // Tree Access Policies (for navigating specific trees)
  // ---------------------------------------------------------------------------

  /** Access to Content tree (requires Content section) */
  TreeAccessDocuments: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.content),

  /** Access to Media tree (requires Media section) */
  TreeAccessMedia: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.media),

  /** Access to Data Types tree (requires Settings section) */
  TreeAccessDataTypes: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.settings),

  /** Access to Dictionary tree (requires Translation section) */
  TreeAccessDictionary: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.translation),

  /** Access to Document Types tree (requires Settings section) */
  TreeAccessDocumentTypes: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.settings),

  /** Access to Languages tree (requires Settings section) */
  TreeAccessLanguages: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.settings),

  /** Access to Media Types tree (requires Settings section) */
  TreeAccessMediaTypes: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.settings),

  /** Access to Member Groups tree (requires Members section) */
  TreeAccessMemberGroups: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.members),

  /** Access to Member Types tree (requires Settings section) */
  TreeAccessMemberTypes: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.settings),

  /** Access to Partial Views tree (requires Settings section) */
  TreeAccessPartialViews: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.settings),

  /** Access to Relation Types tree (requires Settings section) */
  TreeAccessRelationTypes: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.settings),

  /** Access to Scripts tree (requires Settings section) */
  TreeAccessScripts: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.settings),

  /** Access to Stylesheets tree (requires Settings section) */
  TreeAccessStylesheets: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.settings),

  /** Access to Templates tree (requires Settings or Content section) */
  TreeAccessTemplates: (user: UserContext) =>
    user.allowedSections.some(
      (section) => section === sections.settings || section === sections.content
    ),

  /** Access to Webhooks tree (requires Settings section) */
  TreeAccessWebhooks: (user: UserContext) =>
    user.allowedSections.some((section) => section === sections.settings),

  // ---------------------------------------------------------------------------
  // Combined Policies (for tools that span multiple areas)
  // ---------------------------------------------------------------------------

  /** Access for content tree operations (multiple sections) */
  SectionAccessForContentTree: (user: UserContext) =>
    user.allowedSections.some(
      (section) =>
        section === sections.content ||
        section === sections.media ||
        section === sections.users ||
        section === sections.settings ||
        section === sections.packages ||
        section === sections.members
    ),

  /** Access to Dictionary or Templates (Translation or Settings) */
  TreeAccessDictionaryOrTemplates: (user: UserContext) =>
    user.allowedSections.some(
      (section) =>
        section === sections.translation || section === sections.settings
    ),

  /** Access to Documents or Document Types (Content or Settings) */
  TreeAccessDocumentsOrDocumentTypes: (user: UserContext) =>
    user.allowedSections.some(
      (section) => section === sections.content || section === sections.settings
    ),

  /** Access to Media or Media Types (Media or Settings) */
  TreeAccessMediaOrMediaTypes: (user: UserContext) =>
    user.allowedSections.some(
      (section) => section === sections.media || section === sections.settings
    ),

  /** Access to Members or Member Types (Members or Settings) */
  TreeAccessMembersOrMemberTypes: (user: UserContext) =>
    user.allowedSections.some(
      (section) => section === sections.settings || section === sections.members
    ),
};
