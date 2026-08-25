import { Events } from "discord.js";
import type { BotEvent } from "./types.js";
import { logger } from "../../utils/logger.js";
import { toError, UserFacingError } from "../../utils/errors.js";
import { handleQueueComponentInteraction } from "../../commands/queue.js";

export const interactionCreateEvent: BotEvent<typeof Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  async execute(client, interaction) {
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      try {
        await handleQueueComponentInteraction(interaction);
      } catch (error) {
        const resolvedError = toError(error);
        logger.error("Component interaction failed", resolvedError);

        const content =
          resolvedError instanceof UserFacingError
            ? resolvedError.message
            : "Something went wrong while processing that interaction.";

        if (interaction.deferred || interaction.replied) {
          await interaction
            .editReply({ content, embeds: [], components: [] })
            .catch((editReplyError) => logger.error("Failed to edit component error response", toError(editReplyError)));
          return;
        }

        await interaction
          .reply({ content, ephemeral: true })
          .catch((replyError) => logger.error("Failed to send component error response", toError(replyError)));
      }

      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = client.commands.get(interaction.commandName);

    if (!command) {
      logger.warn(`No command handler found for /${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      const resolvedError = toError(error);
      logger.error(`Command /${interaction.commandName} failed`, resolvedError);

      const content =
        resolvedError instanceof UserFacingError
          ? resolvedError.message
          : "Something went wrong while processing that command.";

      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content }).catch((editReplyError) => {
          logger.error("Failed to edit deferred error response", toError(editReplyError));
        });
        return;
      }

      if (interaction.replied) {
        await interaction.followUp({ content, ephemeral: true }).catch((followUpError) => {
          logger.error("Failed to send follow-up error response", toError(followUpError));
        });
        return;
      }

      await interaction.reply({ content, ephemeral: true }).catch((replyError) => {
        logger.error("Failed to send error response", toError(replyError));
      });
    }
  }
};
