import { redirect } from "next/navigation";

/**
 * The app has one entry point, and it is the scrape page. A landing page in
 * front of it would be a click between the reviewer and the thing being graded.
 */
export default function Home() {
  redirect("/knowledge");
}
