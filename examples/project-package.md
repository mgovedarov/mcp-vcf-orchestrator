# Project Package

Use this flow to publish project content into vRO without creating duplicate packages. Configure `VCFA_PROJECT_PACKAGE_NAME` or pass the same exact `packageName` to each tool.

Prefer this package path for reusable workflows, actions, configurations, and resources. Use direct artifact imports only for narrow validation or explicitly requested one-off tests.

The package flow is intentionally explicit: first prove the content exists and behaves as expected, then add that discovered live content to the project package, rebuild the package, inspect the package import details, and only then import it. This keeps vRO package state reusable and prevents a trail of task-specific packages.

```text
ensure-project-package(packageName: "com.example.project")
```

If the package does not exist, create it only with explicit confirmation:

```text
ensure-project-package(packageName: "com.example.project", description: "Project automation", createIfMissing: true, confirm: true)
```

Add discovered content to the same package:

```text
add-workflow-to-project-package(packageName: "com.example.project", workflowId: "<workflow-id>", confirm: true)
add-action-to-project-package(packageName: "com.example.project", categoryName: "com.example.actions", actionName: "echo", confirm: true)
add-configuration-to-project-package(packageName: "com.example.project", configurationId: "<configuration-id>", confirm: true)
add-resource-to-project-package(packageName: "com.example.project", resourceId: "<resource-id>", confirm: true)
```

Rebuild, export, and inspect before import:

```text
rebuild-project-package(packageName: "com.example.project", confirm: true)
export-project-package(packageName: "com.example.project", fileName: "com.example.project.package", overwrite: true)
get-project-package-import-details(packageName: "com.example.project", fileName: "com.example.project.package")
```

Import only after reviewing the package details:

```text
import-project-package(packageName: "com.example.project", fileName: "com.example.project.package", overwrite: true, confirm: true)
```

Before importing, confirm that `get-project-package-import-details` reports the expected package name and expected elements. If the package file contains a different package name, export the correct project package and retry instead of importing the wrong file.
