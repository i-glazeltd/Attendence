// Shared by the contractor page and the admin dashboard: builds a printable invoice.
// "Download PDF" opens the invoice in a new tab and the print box; choose "Save as PDF" as the printer.

function invEsc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function invDmy(s) { return String(s).replace(/^(\d{4})-(\d\d)-(\d\d)/, "$3/$2/$1"); }
function invMoney(n) { return "\u00A3" + Number(n).toFixed(2); }

function printInvoice(inv) {
    const rows = inv.days.map((d) =>
        `<tr><td>${invDmy(d.date)}</td><td>${new Date(d.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long" })}</td>` +
        `<td class="r">${Number(d.hours).toFixed(2)}</td><td class="r">${invMoney(d.rate)}</td><td class="r">${invMoney(d.total)}</td></tr>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice ${invEsc(inv.id || "draft")}</title>
<style>
body { font-family: Arial, sans-serif; margin: 40px; color: #111; }
h1 { margin: 0 0 4px; }
.meta { margin-top: 16px; line-height: 1.7; }
table { width: 100%; border-collapse: collapse; margin-top: 22px; }
th, td { border-bottom: 1px solid #ccc; padding: 8px; text-align: left; }
.r { text-align: right; }
.tot td { font-weight: bold; border-top: 2px solid #111; }
</style></head><body>
<h1>INVOICE</h1>
<div>${inv.id ? "Invoice no: " + invEsc(inv.id) : "DRAFT (not yet submitted)"}</div>
<div class="meta"><b>From:</b> ${invEsc(inv.contractor)}<br><b>To:</b> i-Glaze Limited<br>
<b>Period:</b> ${invDmy(inv.from)} to ${invDmy(inv.to)}${inv.submitted ? "<br><b>Submitted:</b> " + invEsc(invDmy(inv.submitted)) : ""}</div>
<table><tr><th>Date</th><th>Day</th><th class="r">Hours</th><th class="r">Rate / hr</th><th class="r">Total</th></tr>${rows}
<tr class="tot"><td colspan="2">Total</td><td class="r">${Number(inv.totalHours).toFixed(2)}</td><td></td><td class="r">${invMoney(inv.totalAmount)}</td></tr></table>
</body></html>`;

    const w = window.open("", "_blank");
    if (!w) { alert("Please allow pop-ups for this site to download the PDF."); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
}
