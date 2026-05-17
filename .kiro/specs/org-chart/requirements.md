# Requirements Document

## Introduction

The Organization Chart (Org Chart) feature provides a people-first visual hierarchy of the organization's reporting structure. The system displays employees in a tree-based layout where each person can report to a manager, supports drag-and-drop reorganization by admins, and shows vacant roles (open positions) from the jobs table. The feature is organization-scoped, multi-tenant safe, and replaces the current "coming soon" stub in the Workforce section.

## Glossary

- **Org_Chart_System**: The complete organization chart feature including UI, data model, and API
- **Profile**: A user record in the profiles table representing an employee
- **Manager**: A Profile that another Profile reports to via the manager_id relationship
- **Reporting_Chain**: The hierarchical path from a Profile up through their managers to the root
- **Root_Node**: A Profile with no manager (manager_id is null)
- **Sibling**: Profiles that share the same manager_id
- **Vacant_Role**: A job record from the jobs table that has no assigned Profile
- **Org_Admin**: A user with admin or owner role in the organization_members table
- **Org_Member**: Any authenticated user who is a member of the organization
- **Hierarchy_Tree**: The complete tree structure built from Profile nodes and their manager relationships
- **Circular_Reference**: An invalid state where a Profile's reporting chain loops back to itself
- **Job**: A position record from the jobs table with department and name
- **Open_Roles_Panel**: UI component displaying the count and list of Vacant_Roles

## Requirements

### Requirement 1: Profile Hierarchy Data Model

**User Story:** As a system administrator, I want profiles to support self-referential manager relationships and stable sibling ordering, so that the organization's reporting structure can be accurately represented and maintained.

#### Acceptance Criteria

1. THE Org_Chart_System SHALL add a manager_id column to the profiles table as a foreign key referencing profiles.id
2. THE Org_Chart_System SHALL add an org_chart_sort_order column to the profiles table as a numeric field for sibling ordering
3. THE Org_Chart_System SHALL add a job_id column to the profiles table as a foreign key referencing jobs.id
4. THE Org_Chart_System SHALL preserve existing department and job_title text columns without deletion
5. WHEN a Profile is created, THE Org_Chart_System SHALL set manager_id to null by default
6. WHEN a Profile is created, THE Org_Chart_System SHALL set org_chart_sort_order to 0 by default
7. THE Org_Chart_System SHALL create an index on profiles(manager_id) for efficient hierarchy queries
8. THE Org_Chart_System SHALL create an index on profiles(organization_id, manager_id, org_chart_sort_order) for efficient sibling ordering

### Requirement 2: Hierarchy Validation

**User Story:** As a system administrator, I want the system to prevent invalid reporting relationships, so that the organization chart remains logically consistent.

#### Acceptance Criteria

1. WHEN an Org_Admin attempts to set a Profile's manager_id to the Profile's own id, THE Org_Chart_System SHALL reject the update with an error message
2. WHEN an Org_Admin attempts to set a Profile's manager_id such that it creates a Circular_Reference, THE Org_Chart_System SHALL reject the update with an error message
3. WHEN an Org_Admin attempts to assign a manager_id from a different organization, THE Org_Chart_System SHALL reject the update with an error message
4. WHEN the manager_id Profile exists in the same organization, THE Org_Chart_System SHALL clear this validation step but allow other checks to still reject the update
5. WHEN a hierarchy update is validated, THE Org_Chart_System SHALL perform the validation atomically within a database transaction

### Requirement 3: Hierarchy Update API

**User Story:** As an organization admin, I want a secure API to update reporting relationships and sibling order, so that I can reorganize the team structure.

#### Acceptance Criteria

1. THE Org_Chart_System SHALL provide an RPC function update_profile_hierarchy that accepts profile_id, new_manager_id, and new_sort_order parameters
2. WHEN update_profile_hierarchy is called, THE Org_Chart_System SHALL verify the caller is an Org_Admin
3. WHEN update_profile_hierarchy is called, THE Org_Chart_System SHALL verify all profiles belong to the same organization
4. WHEN update_profile_hierarchy is called with valid parameters, THE Org_Chart_System SHALL update the Profile's manager_id and org_chart_sort_order
5. WHEN update_profile_hierarchy is called with any invalid parameter, THE Org_Chart_System SHALL prevent all data changes and return an error
6. WHEN the database update fails after validation passes, THE Org_Chart_System SHALL return an error status
7. THE Org_Chart_System SHALL execute update_profile_hierarchy within a single database transaction
8. WHEN update_profile_hierarchy completes successfully, THE Org_Chart_System SHALL return a success status

### Requirement 4: Hierarchy Tree Building

**User Story:** As an organization member, I want to view the complete organization hierarchy, so that I can understand the reporting structure.

#### Acceptance Criteria

1. THE Org_Chart_System SHALL provide a function to build a Hierarchy_Tree from all Profiles in an organization
2. WHEN building the Hierarchy_Tree, THE Org_Chart_System SHALL identify all Root_Nodes (profiles with manager_id null)
3. WHEN building the Hierarchy_Tree, THE Org_Chart_System SHALL recursively attach child Profiles to their managers
4. WHEN building the Hierarchy_Tree, THE Org_Chart_System SHALL sort Siblings by org_chart_sort_order ascending
5. WHEN building the Hierarchy_Tree, THE Org_Chart_System SHALL include Profile id, full_name, job_title, department, avatar_url, and manager_id in each node
6. WHEN building the Hierarchy_Tree, THE Org_Chart_System SHALL handle multiple Root_Nodes by returning an array of trees
7. THE Org_Chart_System SHALL filter the Hierarchy_Tree to only include Profiles from the current organization

### Requirement 5: Vacant Role Tracking

**User Story:** As an organization member, I want to see which job positions are currently vacant, so that I can understand open hiring needs.

#### Acceptance Criteria

1. THE Org_Chart_System SHALL identify a Vacant_Role as any Job where no Profile has that job_id
2. WHEN querying Vacant_Roles, THE Org_Chart_System SHALL return Job id, name, description, and department_id
3. WHEN querying Vacant_Roles, THE Org_Chart_System SHALL filter to only active jobs (is_active = true)
4. WHEN querying Vacant_Roles, THE Org_Chart_System SHALL filter to only jobs in the current organization
5. WHEN querying Vacant_Roles, THE Org_Chart_System SHALL exclude jobs that have an archived_at timestamp
6. THE Org_Chart_System SHALL provide a count that matches the number of jobs that meet all vacancy criteria

### Requirement 6: Organization Chart Page UI

**User Story:** As an organization member, I want a dedicated org chart page with tree visualization, so that I can explore the organization structure visually.

#### Acceptance Criteria

1. THE Org_Chart_System SHALL create a route at /workspace/org-chart
2. WHEN the org-chart route is accessed, THE Org_Chart_System SHALL render the organization hierarchy as a visual tree
3. WHEN rendering the tree, THE Org_Chart_System SHALL display each Profile as a card showing avatar, full_name, job_title, and department
4. WHEN rendering the tree, THE Org_Chart_System SHALL display Root_Nodes at the top level
5. WHEN rendering the tree, THE Org_Chart_System SHALL display child Profiles below their managers with visual connecting lines
6. WHEN rendering the tree, THE Org_Chart_System SHALL order Siblings according to org_chart_sort_order
7. THE Org_Chart_System SHALL remove the "comingSoon: true" flag from the org-chart menu item in workspace-page.tsx

### Requirement 7: Tree Expand and Collapse Controls

**User Story:** As an organization member, I want to expand and collapse branches of the org chart, so that I can focus on specific parts of the hierarchy.

#### Acceptance Criteria

1. WHEN a Profile node has child Profiles, THE Org_Chart_System SHALL display a collapse/expand toggle button on the node
2. WHEN the collapse button is clicked, THE Org_Chart_System SHALL hide all descendant nodes of that Profile
3. WHEN the expand button is clicked, THE Org_Chart_System SHALL show the immediate child nodes of that Profile
4. THE Org_Chart_System SHALL provide an "Expand All" button that expands all collapsed nodes
5. THE Org_Chart_System SHALL provide a "Collapse All" button that collapses all nodes except Root_Nodes
6. WHEN a node is collapsed, THE Org_Chart_System SHALL display a count of hidden descendants on the node
7. THE Org_Chart_System SHALL preserve expand/collapse state during the current session

### Requirement 8: Search and Filter

**User Story:** As an organization member, I want to search for people in the org chart, so that I can quickly locate specific employees.

#### Acceptance Criteria

1. THE Org_Chart_System SHALL provide a search input field on the org chart page
2. WHEN text is entered in the search field, THE Org_Chart_System SHALL filter visible nodes to those matching the search term
3. WHEN filtering by search, THE Org_Chart_System SHALL match against full_name, job_title, and department fields including cross-field and partial combinations
4. WHEN filtering by search, THE Org_Chart_System SHALL perform case-insensitive matching
5. WHEN a search match is found, THE Org_Chart_System SHALL highlight the matching node
6. WHEN a search match is found, THE Org_Chart_System SHALL automatically expand the tree to show the matching node
7. WHEN the search field is cleared, THE Org_Chart_System SHALL restore the full tree view

### Requirement 9: Open Roles Panel

**User Story:** As an organization member, I want to see a list of open positions, so that I understand current hiring needs.

#### Acceptance Criteria

1. THE Org_Chart_System SHALL display an Open_Roles_Panel on the org chart page
2. WHEN the Open_Roles_Panel is rendered, THE Org_Chart_System SHALL display the total count of Vacant_Roles
3. WHEN the Open_Roles_Panel is opened, THE Org_Chart_System SHALL list all Vacant_Roles with job name and department
4. WHEN the Open_Roles_Panel is closed, THE Org_Chart_System SHALL show only the count of Vacant_Roles
5. THE Org_Chart_System SHALL allow toggling the Open_Roles_Panel between open and closed states
6. WHEN there are no Vacant_Roles, THE Org_Chart_System SHALL display a message indicating no open positions
7. WHEN jobs or profiles data changes, THE Org_Chart_System SHALL update both the Vacant_Roles count and list regardless of panel state

### Requirement 10: Admin Editing - Assign Manager

**User Story:** As an organization admin, I want to assign or change a person's manager, so that I can update the reporting structure.

#### Acceptance Criteria

1. WHEN an Org_Admin views the org chart, THE Org_Chart_System SHALL display an "Edit" button on each Profile node
2. WHEN the Edit button is clicked, THE Org_Chart_System SHALL open a manager assignment dialog
3. WHEN the manager assignment dialog is open, THE Org_Chart_System SHALL display a searchable dropdown of all Profiles in the organization
4. WHEN a new manager is selected, THE Org_Chart_System SHALL call update_profile_hierarchy with the new manager_id
5. WHEN the manager assignment succeeds, THE Org_Chart_System SHALL update the tree visualization immediately
6. WHEN the manager assignment fails, THE Org_Chart_System SHALL display the error message to the Org_Admin
7. THE Org_Chart_System SHALL exclude the current Profile from the manager selection dropdown to prevent self-assignment

### Requirement 11: Admin Editing - Assign Job

**User Story:** As an organization admin, I want to assign or change a person's job, so that their role is accurately reflected in the org chart.

#### Acceptance Criteria

1. WHEN an Org_Admin views the org chart, THE Org_Chart_System SHALL display a "Change Job" option in the edit menu
2. WHEN the Change Job option is selected, THE Org_Chart_System SHALL open a job assignment dialog
3. WHEN the job assignment dialog is open, THE Org_Chart_System SHALL display a searchable dropdown of all active Jobs in the organization
4. WHEN a new job is selected, THE Org_Chart_System SHALL update the Profile's job_id
5. WHEN the job assignment succeeds, THE Org_Chart_System SHALL update the Profile node to display the new job information
6. WHEN the job assignment succeeds and the job was previously vacant, THE Org_Chart_System SHALL update the Vacant_Roles count
7. THE Org_Chart_System SHALL allow clearing the job assignment to set job_id to null

### Requirement 12: Admin Editing - Drag and Drop Reordering

**User Story:** As an organization admin, I want to drag and drop people to reorganize the hierarchy, so that I can quickly restructure teams.

#### Acceptance Criteria

1. WHEN an Org_Admin views the org chart, THE Org_Chart_System SHALL make Profile nodes draggable
2. WHEN a Profile node is dragged over another Profile node, THE Org_Chart_System SHALL highlight the target as a valid drop zone
3. WHEN a Profile node is dropped on another Profile node, THE Org_Chart_System SHALL set the target as the new manager
4. WHEN a Profile node is dropped between Siblings, THE Org_Chart_System SHALL update the org_chart_sort_order to reorder the Siblings
5. WHEN any drag and drop operation completes, THE Org_Chart_System SHALL call update_profile_hierarchy with the new manager_id and sort_order
6. WHEN a drag and drop operation would create a Circular_Reference, THE Org_Chart_System SHALL always reject the drop and display the circular reference error regardless of other rejection reasons
7. THE Org_Chart_System SHALL provide visual feedback during drag operations showing valid and invalid drop targets

### Requirement 13: Row Level Security for Hierarchy Data

**User Story:** As a system administrator, I want hierarchy data to be protected by row-level security, so that users can only access data from their organization.

#### Acceptance Criteria

1. THE Org_Chart_System SHALL enforce that Org_Members can read all Profiles in their organization
2. THE Org_Chart_System SHALL enforce that only Org_Admins can update manager_id on Profiles
3. THE Org_Chart_System SHALL enforce that only Org_Admins can update org_chart_sort_order on Profiles
4. THE Org_Chart_System SHALL enforce that only Org_Admins can update job_id on Profiles
5. THE Org_Chart_System SHALL enforce that update_profile_hierarchy can only be called by Org_Admins
6. THE Org_Chart_System SHALL enforce that all hierarchy queries filter by organization_id
7. THE Org_Chart_System SHALL reject any attempt to create cross-organization reporting relationships

### Requirement 14: Mobile Responsive Layout

**User Story:** As an organization member using a mobile device, I want the org chart to be usable on small screens, so that I can view the hierarchy on any device.

#### Acceptance Criteria

1. WHEN the org chart is viewed on a screen width less than 768px, THE Org_Chart_System SHALL switch to a mobile-optimized layout
2. WHEN in mobile layout, THE Org_Chart_System SHALL display the tree in a vertical list format instead of a horizontal tree
3. WHEN in mobile layout, THE Org_Chart_System SHALL show one level of hierarchy at a time with navigation to drill down
4. WHEN in mobile layout, THE Org_Chart_System SHALL provide a "Back" button to navigate up the hierarchy
5. WHEN in mobile layout, THE Org_Chart_System SHALL display Profile cards in a compact format
6. WHEN in mobile layout, THE Org_Chart_System SHALL make the search input and Open_Roles_Panel accessible
7. WHEN in mobile layout, THE Org_Chart_System SHALL disable drag and drop editing for Org_Admins

### Requirement 15: Data Migration and Backfill

**User Story:** As a system administrator, I want existing profile data to be migrated to the new hierarchy model, so that the org chart can display current organizational structure.

#### Acceptance Criteria

1. THE Org_Chart_System SHALL provide a migration script that adds manager_id, org_chart_sort_order, and job_id columns to profiles
2. WHEN the migration runs, THE Org_Chart_System SHALL attempt to match existing job_title and department text to Jobs in the jobs table
3. WHEN an exact match is found between job_title/department and a Job, THE Org_Chart_System SHALL set the Profile's job_id
4. WHEN no exact match is found, THE Org_Chart_System SHALL leave job_id as null and preserve the job_title and department text fields
5. THE Org_Chart_System SHALL set all manager_id values to null initially (no reporting relationships)
6. THE Org_Chart_System SHALL set all org_chart_sort_order values to 0 initially
7. THE Org_Chart_System SHALL preserve all existing department and job_title text columns without modification or deletion

### Requirement 16: Performance Optimization

**User Story:** As an organization member in a large organization, I want the org chart to load quickly, so that I can access the information without delay.

#### Acceptance Criteria

1. WHEN the org chart page loads, THE Org_Chart_System SHALL fetch all Profiles for the organization in a single query
2. WHEN the org chart page loads, THE Org_Chart_System SHALL fetch all Vacant_Roles in a single query
3. THE Org_Chart_System SHALL build the Hierarchy_Tree on the client side from the fetched Profile data
4. WHEN the organization has more than 100 Profiles, THE Org_Chart_System SHALL initially render only the first 3 levels of the hierarchy
5. WHEN the organization has more than 100 Profiles, THE Org_Chart_System SHALL lazy-load deeper levels when nodes are expanded
6. THE Org_Chart_System SHALL cache the Hierarchy_Tree data for 5 minutes to reduce database queries
7. WHEN Profile data changes, THE Org_Chart_System SHALL invalidate the cache and refetch the data
8. WHEN Job data changes, THE Org_Chart_System SHALL invalidate the cache and refetch the data
