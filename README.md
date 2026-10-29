# i-Glaze Site Attendance

Staff check in and out by PIN + site QR code. Admins manage users, sites and hours from `admin.html`.

**Current release: 1.5.0**

## Where each file lives
| File | Goes in |
|---|---|
| `index.html`, `app.js`, `style.css`, `invoice.js` | GitHub (check-in page; `invoice.js` is shared with the dashboard) |
| `admin.html`, `admin.js`, `admin.css` | GitHub (admin dashboard) |
| `company logo1.png` | GitHub |
| `Code.gs` | Google Apps Script (Extensions > Apps Script in the Google Sheet), NOT in GitHub |

## Version numbers (how to tell what's loaded)
The footer of both pages shows the version, e.g. `v1.0.2`.
- Plain grey `v1.0.2`: the page and the script match, so everything is up to date.
- Amber text: the page and script versions differ. "Out of date" means press Ctrl+Shift+R, and if that doesn't fix it the GitHub files need updating. "Script needs redeploying" means Code.gs in Apps Script needs a new deployment.

The version must match in all of these (change them together, same number):
1. `APP_VERSION` at the top of `app.js` and `admin.js`
2. `SCRIPT_VERSION` at the top of `Code.gs`
3. The `?v=` numbers on the script/style links in `index.html` and `admin.html`

## Releasing a change
1. Update the files in GitHub and bump the version numbers above.
2. Paste the new `Code.gs` into Apps Script, then Deploy > Manage deployments > pencil icon > Version: New version > Deploy.
3. Wait a minute or two for GitHub Pages, hard refresh (Ctrl+Shift+R), check the footer shows matching versions.

## Google Sheet tabs
- **Users:** Name | PIN | Status (Active/Inactive) | Role. Admin PINs must be 6-8 digits.
  Roles: `Contractor` (goes straight to Site Attendance), `QA` (straight to the QA inspection), `Contractor/QA` (sees a menu with both; the QA project defaults to the site they're checked in at), `Admin` (dashboard). Blank counts as Contractor.
- **Sites:** SiteID | SiteName | Latitude | Longitude | RadiusMetres | Status (Active/Inactive)
- **AuditLog:** Timestamp | Name | Action | Site ID | Site Name | Status | Reason | Dist | Google Maps Link | Check-Out Time | Check-Out Dist | Check-Out Map | User Comments | Admin Comments

- **Invoices** (created automatically): Invoice ID | Submitted | Contractor | Period From | Period To | Total Hours | Total Amount | Status | Breakdown. Contractors build these from "My Hours" (weekly, Monday to Sunday); hours come from the AuditLog and are worked out by the script, the contractor only enters the hourly rate for each day. Resubmitting the same week updates that invoice. Shifts with no check-out are not counted until an admin corrects them.
- **QAReports** (created automatically): Timestamp | Inspector | Site ID | Site Name | Overall | Checks | Photos (links). QA photos are saved in a Google Drive folder called "Site QA Photos" (in the Drive of the account that owns the script). Share that folder with anyone who needs to open the photo links. After first pasting Code.gs, run `setupQaFolder` once in Apps Script to give it Drive permission.
- QA checklist items are the `QA_CHECKS` list near the top of the QA section in `app.js`.

Rules: check-in/out only within the site's RadiusMetres (500m if blank); anyone still checked in at 23:00 is closed automatically (needs `setupAutoLogoutTrigger` run once in Apps Script).

## Changelog
- **1.5.0** Contractors: My Hours + daily-rate invoices (PDF). Admin: Invoices tab, "Generate an unused PIN" button.
- **1.4.0** Each site has its own check-in radius (RadiusMetres), set in the dashboard; the map picker circle follows it.
- **1.3.1** Adding a site no longer asks for a Site ID: it is filled in automatically from the site name (and kept if the site is renamed, so printed QR codes keep working).
- **1.3.0** Admin dashboard: QA Reports tab (filter, see results, view photos).
- **1.2.0** Roles: Contractor, QA, Contractor/QA and Admin decide where people land after their PIN.
- **1.1.0** Contractor menu (Site Attendance / Quality Assurance) and QA inspection form with photos.
- **1.0.2** Footer shows just the version number (amber warning only if page and script differ).
- **1.0.1** Refresh button on the admin dashboard; clearer version mismatch messages; README.
- **1.0.0** Version numbers in the footer; location picker; QR generator; admin dashboard; manual check-out; auto log-out.

Built by Karl Harris
