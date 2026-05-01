import { defineConfig } from "vitepress";

export default defineConfig({
  title: "VCF Orchestrator MCP",
  description:
    "MCP server documentation for VCF Automation Orchestrator and Aria Automation operations.",
  base: "/mcp-vcf-orchestrator/",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/overview" },
      { text: "Tools", link: "/reference/tools" },
      { text: "How-Tos", link: "/how-tos/workflows" },
    ],
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Overview", link: "/guide/overview" },
          { text: "Installation", link: "/guide/installation" },
          { text: "Configuration", link: "/guide/configuration" },
          { text: "MCP Client Setup", link: "/guide/mcp-clients" },
        ],
      },
      {
        text: "Tool Reference",
        items: [
          { text: "Tools", link: "/reference/tools" },
          { text: "Resources And Prompts", link: "/reference/resources-prompts" },
        ],
      },
      {
        text: "How-Tos",
        items: [
          { text: "Workflows", link: "/how-tos/workflows" },
          { text: "Artifacts", link: "/how-tos/artifacts" },
          { text: "Catalog And Deployments", link: "/how-tos/catalog-deployments" },
          { text: "Templates And Subscriptions", link: "/how-tos/templates-subscriptions" },
          { text: "Configuration And Resources", link: "/how-tos/configuration-resources" },
        ],
      },
      {
        text: "Artifact Lifecycle",
        items: [
          { text: "Lifecycle", link: "/artifacts/lifecycle" },
          { text: "Workflow Authoring", link: "/artifacts/workflow-authoring" },
        ],
      },
      {
        text: "Operations",
        items: [
          { text: "Safety", link: "/operations/safety" },
          { text: "Troubleshooting", link: "/operations/troubleshooting" },
          { text: "Contributing", link: "/operations/contributing" },
        ],
      },
    ],
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/mgovedarov/mcp-vcf-orchestrator",
      },
    ],
    search: {
      provider: "local",
    },
    editLink: {
      pattern:
        "https://github.com/mgovedarov/mcp-vcf-orchestrator/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
  },
});
