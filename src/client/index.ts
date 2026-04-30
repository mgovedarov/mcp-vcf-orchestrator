import type {
  Action,
  ActionList,
  CatalogItem,
  CatalogItemList,
  CategoryList,
  ConfigElement,
  ConfigElementList,
  Deployment,
  DeploymentActionList,
  DeploymentActionRequestParams,
  DeploymentList,
  DeploymentRequest,
  EventTopicList,
  ResourceElementList,
  SimpleParameter,
  Subscription,
  SubscriptionList,
  Template,
  TemplateList,
  VroClientConfig,
  VroPackage,
  VroPackageList,
  VroPluginList,
  Workflow,
  WorkflowExecution,
  WorkflowExecutionList,
  WorkflowExecutionLogs,
  WorkflowList,
} from "../types.js";
import { ActionClient } from "./action-client.js";
import { CatalogClient } from "./catalog-client.js";
import { CategoryClient } from "./category-client.js";
import { ConfigurationClient } from "./configuration-client.js";
import { VroHttpClient } from "./core.js";
import { DeploymentClient } from "./deployment-client.js";
import { PackageClient } from "./package-client.js";
import { PluginClient } from "./plugin-client.js";
import { ResourceClient } from "./resource-client.js";
import { SubscriptionClient } from "./subscription-client.js";
import { TemplateClient } from "./template-client.js";
import { WorkflowClient } from "./workflow-client.js";

/**
 * Compatibility facade used by the MCP tool modules.
 *
 * Keep this public surface stable so callers can continue importing
 * `VroClient` from `vro-client.js` and calling `client.method(...)`.
 */
export class VroClient {
  private workflows: WorkflowClient;
  private actions: ActionClient;
  private configurations: ConfigurationClient;
  private categories: CategoryClient;
  private subscriptions: SubscriptionClient;
  private catalog: CatalogClient;
  private deployments: DeploymentClient;
  private templates: TemplateClient;
  private packages: PackageClient;
  private resources: ResourceClient;
  private plugins: PluginClient;

  constructor(config: VroClientConfig) {
    const http = new VroHttpClient(config);
    this.workflows = new WorkflowClient(http);
    this.actions = new ActionClient(http);
    this.configurations = new ConfigurationClient(http);
    this.categories = new CategoryClient(http);
    this.subscriptions = new SubscriptionClient(http);
    this.catalog = new CatalogClient(http);
    this.deployments = new DeploymentClient(http);
    this.templates = new TemplateClient(http);
    this.packages = new PackageClient(http);
    this.resources = new ResourceClient(http);
    this.plugins = new PluginClient(http);
  }

  listWorkflows(filter?: string): Promise<WorkflowList> {
    return this.workflows.listWorkflows(filter);
  }

  getWorkflow(id: string): Promise<Workflow> {
    return this.workflows.getWorkflow(id);
  }

  createWorkflow(
    categoryId: string,
    name: string,
    description?: string,
  ): Promise<Workflow> {
    return this.workflows.createWorkflow(categoryId, name, description);
  }

  runWorkflow(
    id: string,
    inputs?: SimpleParameter[],
  ): Promise<WorkflowExecution> {
    return this.workflows.runWorkflow(id, inputs);
  }

  getWorkflowExecution(
    workflowId: string,
    executionId: string,
    options?: { showDetails?: boolean },
  ): Promise<WorkflowExecution> {
    return this.workflows.getWorkflowExecution(
      workflowId,
      executionId,
      options,
    );
  }

  getWorkflowExecutionLogs(
    workflowId: string,
    executionId: string,
    options?: { maxResult?: number },
  ): Promise<WorkflowExecutionLogs> {
    return this.workflows.getWorkflowExecutionLogs(
      workflowId,
      executionId,
      options,
    );
  }

  listWorkflowExecutions(
    workflowId: string,
    options?: { maxResults?: number; status?: string },
  ): Promise<WorkflowExecutionList> {
    return this.workflows.listWorkflowExecutions(workflowId, options);
  }

  deleteWorkflow(id: string): Promise<void> {
    return this.workflows.deleteWorkflow(id);
  }

  getWorkflowDirectory(): string {
    return this.workflows.getWorkflowDirectory();
  }

  exportWorkflowFile(
    id: string,
    fileName: string,
    overwrite = false,
  ): Promise<string> {
    return this.workflows.exportWorkflowFile(id, fileName, overwrite);
  }

  importWorkflowFile(
    categoryId: string,
    fileName: string,
    overwrite = true,
  ): Promise<void> {
    return this.workflows.importWorkflowFile(categoryId, fileName, overwrite);
  }

  listActions(filter?: string): Promise<ActionList> {
    return this.actions.listActions(filter);
  }

  getAction(id: string): Promise<Action> {
    return this.actions.getAction(id);
  }

  getActionDirectory(): string {
    return this.actions.getActionDirectory();
  }

  exportActionFile(
    id: string,
    fileName: string,
    overwrite = false,
  ): Promise<string> {
    return this.actions.exportActionFile(id, fileName, overwrite);
  }

  importActionFile(categoryName: string, fileName: string): Promise<void> {
    return this.actions.importActionFile(categoryName, fileName);
  }

  createAction(params: {
    moduleName: string;
    name: string;
    script: string;
    inputParameters?: { name: string; type: string; description?: string }[];
    returnType?: string;
  }): Promise<Action> {
    return this.actions.createAction(params);
  }

  deleteAction(id: string): Promise<void> {
    return this.actions.deleteAction(id);
  }

  listConfigurations(filter?: string): Promise<ConfigElementList> {
    return this.configurations.listConfigurations(filter);
  }

  getConfiguration(id: string): Promise<ConfigElement> {
    return this.configurations.getConfiguration(id);
  }

  getConfigurationDirectory(): string {
    return this.configurations.getConfigurationDirectory();
  }

  exportConfigurationFile(
    id: string,
    fileName: string,
    overwrite = false,
  ): Promise<string> {
    return this.configurations.exportConfigurationFile(id, fileName, overwrite);
  }

  importConfigurationFile(categoryId: string, fileName: string): Promise<void> {
    return this.configurations.importConfigurationFile(categoryId, fileName);
  }

  createConfiguration(
    categoryId: string,
    name: string,
    description?: string,
    attributes?: { name: string; type: string; value?: string }[],
  ): Promise<ConfigElement> {
    return this.configurations.createConfiguration(
      categoryId,
      name,
      description,
      attributes,
    );
  }

  deleteConfiguration(id: string): Promise<void> {
    return this.configurations.deleteConfiguration(id);
  }

  updateConfiguration(
    id: string,
    params: {
      name?: string;
      description?: string;
      attributes?: { name: string; type: string; value?: string }[];
    },
  ): Promise<void> {
    return this.configurations.updateConfiguration(id, params);
  }

  listCategories(categoryType: string, filter?: string): Promise<CategoryList> {
    return this.categories.listCategories(categoryType, filter);
  }

  listSubscriptions(projectId?: string): Promise<SubscriptionList> {
    return this.subscriptions.listSubscriptions(projectId);
  }

  getSubscription(id: string): Promise<Subscription> {
    return this.subscriptions.getSubscription(id);
  }

  createSubscription(params: {
    name: string;
    eventTopicId: string;
    runnableType: string;
    runnableId: string;
    projectId?: string;
    description?: string;
    blocking?: boolean;
    priority?: number;
    timeout?: number;
    disabled?: boolean;
    constraints?: Record<string, unknown>;
  }): Promise<Subscription> {
    return this.subscriptions.createSubscription(params);
  }

  updateSubscription(
    id: string,
    params: {
      name?: string;
      description?: string;
      disabled?: boolean;
      runnableId?: string;
      runnableType?: string;
      blocking?: boolean;
      priority?: number;
      timeout?: number;
      constraints?: Record<string, unknown>;
    },
  ): Promise<Subscription> {
    return this.subscriptions.updateSubscription(id, params);
  }

  deleteSubscription(id: string): Promise<void> {
    return this.subscriptions.deleteSubscription(id);
  }

  listEventTopics(): Promise<EventTopicList> {
    return this.subscriptions.listEventTopics();
  }

  listCatalogItems(search?: string): Promise<CatalogItemList> {
    return this.catalog.listCatalogItems(search);
  }

  getCatalogItem(id: string): Promise<CatalogItem> {
    return this.catalog.getCatalogItem(id);
  }

  createDeploymentFromCatalogItem(params: {
    catalogItemId: string;
    deploymentName: string;
    projectId: string;
    version?: string;
    reason?: string;
    inputs?: Record<string, unknown>;
  }): Promise<Deployment> {
    return this.catalog.createDeploymentFromCatalogItem(params);
  }

  listDeployments(
    search?: string,
    projectId?: string,
  ): Promise<DeploymentList> {
    return this.deployments.listDeployments(search, projectId);
  }

  getDeployment(id: string): Promise<Deployment> {
    return this.deployments.getDeployment(id);
  }

  deleteDeployment(id: string): Promise<void> {
    return this.deployments.deleteDeployment(id);
  }

  listDeploymentActions(deploymentId: string): Promise<DeploymentActionList> {
    return this.deployments.listDeploymentActions(deploymentId);
  }

  runDeploymentAction(
    params: DeploymentActionRequestParams,
  ): Promise<DeploymentRequest> {
    return this.deployments.runDeploymentAction(params);
  }

  listTemplates(search?: string, projectId?: string): Promise<TemplateList> {
    return this.templates.listTemplates(search, projectId);
  }

  getTemplate(id: string): Promise<Template> {
    return this.templates.getTemplate(id);
  }

  createTemplate(params: {
    name: string;
    projectId: string;
    description?: string;
    content?: string;
    requestScopeOrg?: boolean;
  }): Promise<Template> {
    return this.templates.createTemplate(params);
  }

  deleteTemplate(id: string): Promise<void> {
    return this.templates.deleteTemplate(id);
  }

  listPackages(filter?: string): Promise<VroPackageList> {
    return this.packages.listPackages(filter);
  }

  getPackage(name: string): Promise<VroPackage> {
    return this.packages.getPackage(name);
  }

  getPackageDirectory(): string {
    return this.packages.getPackageDirectory();
  }

  exportPackage(
    name: string,
    fileName: string,
    overwrite = false,
  ): Promise<string> {
    return this.packages.exportPackage(name, fileName, overwrite);
  }

  importPackage(fileName: string, overwrite = true): Promise<void> {
    return this.packages.importPackage(fileName, overwrite);
  }

  deletePackage(name: string, deleteContents = false): Promise<void> {
    return this.packages.deletePackage(name, deleteContents);
  }

  listResources(filter?: string): Promise<ResourceElementList> {
    return this.resources.listResources(filter);
  }

  getResourceDirectory(): string {
    return this.resources.getResourceDirectory();
  }

  exportResource(
    id: string,
    fileName: string,
    overwrite = false,
  ): Promise<string> {
    return this.resources.exportResource(id, fileName, overwrite);
  }

  importResource(categoryId: string, fileName: string): Promise<void> {
    return this.resources.importResource(categoryId, fileName);
  }

  updateResourceContent(
    id: string,
    fileName: string,
    changesetSha?: string,
  ): Promise<void> {
    return this.resources.updateResourceContent(id, fileName, changesetSha);
  }

  deleteResource(id: string, force = false): Promise<void> {
    return this.resources.deleteResource(id, force);
  }

  listPlugins(filter?: string): Promise<VroPluginList> {
    return this.plugins.listPlugins(filter);
  }
}
